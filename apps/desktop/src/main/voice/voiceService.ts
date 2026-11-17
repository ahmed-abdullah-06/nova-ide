/**
 * The voice service of the main process (spec §15.1, §15.3, §19.4).
 *
 * The service is the only place that decides what happens with a
 * recording:
 *
 *  - it reads the settings (never the renderer),
 *  - it refuses a switched off assistant, a missing engine and a missing
 *    model with an honest message,
 *  - it enforces the limit of the audio (the renderer cannot send more),
 *  - it never sends the audio to a cloud service while the local-only
 *    mode is on,
 *  - it runs one local process at a time and it can stop it.
 *
 * The renderer cannot choose the executable, the model or the engine: it
 * only sends the samples of the recording that the user made.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MAX_AUDIO_BYTES,
  MIN_RECORDING_SECONDS,
  SPEECH_SAMPLE_RATE,
  TRANSCRIPTION_TIMEOUT_MS,
  type VoiceResult,
  type VoiceSettings,
  type VoiceTranscript,
} from '../../shared/voice-types';
import { EngineError, LocalSpeechEngine } from './localEngine';
import { buildEngineArgs } from './transcript';
import { encodeWav } from './wav';
import type { VoiceSettingsStore } from './voiceSettings';

/** True when the path names a file that exists. */
export async function isExistingFile(pathValue: string): Promise<boolean> {
  try {
    const stats = await fs.stat(pathValue);
    return stats.isFile();
  } catch {
    return false;
  }
}

/** The options of the service (the engine is injected in the tests). */
export interface VoiceServiceOptions {
  /** The settings of the voice assistant. */
  settings: VoiceSettingsStore;
  /** True while nothing may leave this machine. */
  isLocalOnly: () => boolean;
  /** The engine (defaults to the external process). */
  engine?: LocalSpeechEngine;
  /** True when the path names an existing file. */
  isFile?: (pathValue: string) => Promise<boolean>;
}

/** The voice service of the application. */
export class VoiceService {
  private readonly engine: LocalSpeechEngine;
  private readonly isFile: (pathValue: string) => Promise<boolean>;

  constructor(private readonly options: VoiceServiceOptions) {
    this.engine = options.engine ?? new LocalSpeechEngine();
    this.isFile = options.isFile ?? isExistingFile;
  }

  /** True while a speech engine is running. */
  get running(): boolean {
    return this.engine.running;
  }

  /** The settings that are stored right now. */
  settings(): Promise<VoiceSettings> {
    return this.options.settings.get();
  }

  /**
   * Stops the running recognition (no process outlives the request).
   */
  cancel(): void {
    this.engine.cancel();
  }

  /**
   * Recognises the speech of one recording.
   *
   * @param samples The samples (16 kHz, mono, 16 bit).
   * @param meta `truncated` when the recording hit the limit; `cloudApproved`
   * only when the user approved a cloud service for *this* recording.
   */
  async transcribe(
    samples: Int16Array,
    meta: { truncated?: boolean; cloudApproved?: boolean } = {},
  ): Promise<VoiceResult<VoiceTranscript>> {
    const settings = await this.options.settings.get();
    if (!settings.enabled) {
      return {
        ok: false,
        code: 'disabled',
        message:
          'The voice assistant is switched off. Switch it on in the voice settings.',
      };
    }
    if (settings.engine === 'none') {
      return {
        ok: false,
        code: 'no-engine',
        message:
          'No speech engine is configured. Choose the local engine in the voice settings.',
      };
    }
    if (settings.engine === 'cloud') {
      if (this.options.isLocalOnly()) {
        return {
          ok: false,
          code: 'local-only',
          message:
            'The local-only mode is switched on: the audio may not be sent to a cloud speech service.',
        };
      }
      if (meta.cloudApproved !== true) {
        return {
          ok: false,
          code: 'not-approved',
          message:
            'The audio was not sent: a cloud speech service needs your approval for this recording.',
        };
      }
      return {
        ok: false,
        code: 'disabled',
        message:
          'The cloud speech engine is not available in this build. Use the local engine instead.',
      };
    }

    if (samples.length * 2 > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        code: 'too-large',
        message: 'The recording is too large. Record a shorter message.',
      };
    }
    if (samples.length < SPEECH_SAMPLE_RATE * MIN_RECORDING_SECONDS) {
      return {
        ok: false,
        code: 'too-short',
        message: 'The recording is too short. Hold the button a little longer.',
      };
    }
    if (this.engine.running) {
      return {
        ok: false,
        code: 'busy',
        message: 'A speech recognition is still running.',
      };
    }
    if (
      settings.enginePath.length === 0 ||
      !path.isAbsolute(settings.enginePath) ||
      !(await this.isFile(settings.enginePath))
    ) {
      return {
        ok: false,
        code: 'no-engine',
        message:
          'The local speech engine was not found. Set its path in the voice settings.',
      };
    }
    if (
      settings.modelPath.length === 0 ||
      !path.isAbsolute(settings.modelPath) ||
      !(await this.isFile(settings.modelPath))
    ) {
      return {
        ok: false,
        code: 'no-model',
        message:
          'The speech model was not found. Download or choose a model in the voice settings.',
      };
    }

    try {
      const text = await this.engine.transcribe(encodeWav(samples), {
        executable: settings.enginePath,
        args: buildEngineArgs(settings.engineArgs, settings.modelPath),
        timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
      });
      return {
        ok: true,
        value: {
          text,
          seconds: samples.length / SPEECH_SAMPLE_RATE,
          truncated: meta.truncated === true,
        },
      };
    } catch (error) {
      if (error instanceof EngineError) {
        const code =
          error.code === 'busy'
            ? 'busy'
            : error.code === 'timeout'
              ? 'timeout'
              : error.code === 'cancelled'
                ? 'cancelled'
                : 'failed';
        return { ok: false, code, message: error.message };
      }
      return {
        ok: false,
        code: 'failed',
        message: 'The speech recognition failed.',
      };
    }
  }
}
