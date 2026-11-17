/**
 * The external local speech engine (spec §15.1, Milestone 8).
 *
 * The application speaks a tiny pipe protocol with the executable the
 * user configured: the recorded audio is written to its standard input as
 * a WAV file, and the recognised text is read from its standard output.
 *
 * The rules of this module:
 *
 *  - the process is started without a shell, so the path is the program,
 *  - only one process runs at a time; a second request is refused,
 *  - the output is bounded (a hostile or broken engine cannot exhaust the
 *    memory) and the run has a hard timeout,
 *  - `cancel()` kills the process tree, so no engine outlives the request,
 *  - nothing is written to the disk: the audio goes through the pipe.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  MAX_ENGINE_OUTPUT_BYTES,
  TRANSCRIPTION_TIMEOUT_MS,
} from '../../shared/voice-types';
import { cleanTranscript } from './transcript';

/** The maximum number of bytes of the error output that is kept. */
const MAX_ERROR_BYTES = 8 * 1024;

/** The reason why the engine failed. */
export type EngineFailure = 'busy' | 'timeout' | 'cancelled' | 'failed';

/** A failure of the local speech engine. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: EngineFailure,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** The configuration of one run. */
export interface EngineConfig {
  /** The absolute path of the executable. */
  executable: string;
  /** The arguments (the model is already substituted). */
  args: string[];
  /** How long the run may take (milliseconds). */
  timeoutMs?: number;
}

/** The function that starts the process (injected in the tests). */
export type EngineSpawn = (
  command: string,
  args: string[],
  options: {
    stdio: ['pipe', 'pipe', 'pipe'];
    windowsHide: boolean;
    shell: boolean;
  },
) => ChildProcess;

/**
 * Runs the configured engine once per request.
 *
 * The engine is not kept in memory: it starts for the recognition, exits
 * afterwards and is started again for the next one. That keeps the memory
 * of an idle application small and needs no "unload" step.
 */
export class LocalSpeechEngine {
  private active: ChildProcess | null = null;
  private cancelling = false;

  constructor(private readonly spawnEngine: EngineSpawn = spawn) {}

  /** True while an engine process is running. */
  get running(): boolean {
    return this.active !== null;
  }

  /**
   * Recognises the speech of one recording.
   *
   * @param wav The recording as a WAV file.
   * @param config The executable, the arguments and the timeout.
   * @returns The clean text (possibly empty).
   * @throws EngineError when the process fails, times out or is cancelled.
   */
  async transcribe(wav: Buffer, config: EngineConfig): Promise<string> {
    if (this.active !== null) {
      throw new EngineError(
        'Another speech recognition is still running.',
        'busy',
      );
    }
    this.cancelling = false;
    return await new Promise<string>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnEngine(config.executable, config.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        reject(
          new EngineError(
            error instanceof Error
              ? error.message
              : 'The speech engine could not be started.',
            'failed',
          ),
        );
        return;
      }
      this.active = child;

      const output: Buffer[] = [];
      let outputBytes = 0;
      const errors: Buffer[] = [];
      let errorBytes = 0;
      let settled = false;
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        // The kill is the only way to stop an engine that ignores the
        // end of its input.
        child.kill();
      }, config.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS);

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.active = null;
        action();
      };

      const fail = (message: string, code: EngineFailure): void => {
        finish(() => reject(new EngineError(message, code)));
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_ENGINE_OUTPUT_BYTES) {
          child.kill();
          fail('The speech engine produced too much output.', 'failed');
          return;
        }
        output.push(chunk);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (errorBytes >= MAX_ERROR_BYTES) {
          return;
        }
        errorBytes += chunk.length;
        errors.push(chunk);
      });

      child.on('error', (error) => {
        fail(
          `The speech engine could not be started: ${error.message}`,
          'failed',
        );
      });

      child.on('close', (code) => {
        if (this.cancelling) {
          fail('The speech recognition was cancelled.', 'cancelled');
          return;
        }
        if (timedOut) {
          fail('The speech engine took too long.', 'timeout');
          return;
        }
        const text = cleanTranscript(Buffer.concat(output).toString('utf8'));
        if (code !== 0 && text.length === 0) {
          const detail = Buffer.concat(errors)
            .toString('utf8')
            .trim()
            .slice(0, 500);
          fail(
            detail.length > 0
              ? `The speech engine failed: ${detail}`
              : `The speech engine stopped with code ${code ?? 'unknown'}.`,
            'failed',
          );
          return;
        }
        finish(() => resolve(text));
      });

      // The engine may exit before it reads the input; that is not an
      // application error.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(wav);
    });
  }

  /**
   * Stops the running engine (no process outlives the request).
   *
   * The promise of `transcribe` rejects with the code `cancelled`.
   */
  cancel(): void {
    const child = this.active;
    if (child === null) {
      return;
    }
    this.cancelling = true;
    child.kill();
  }
}
