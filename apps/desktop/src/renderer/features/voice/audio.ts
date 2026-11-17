/**
 * The capture of the microphone (spec §15.1, Milestone 8).
 *
 * The renderer records the microphone and converts the samples into the
 * format that the speech engines expect: 16 kHz, mono, 16 bit signed
 * PCM. The conversion happens while the recording runs, so the memory
 * stays small (a minute of audio is less than two megabytes).
 *
 * The audio is never written to the disk and never leaves the renderer
 * on its own: it is only handed to the main process, which decides what
 * happens with it.
 */

/** The sample rate that the speech engines expect. */
export const SPEECH_SAMPLE_RATE = 16000;
/** The maximum length of one recording (seconds). */
export const MAX_RECORDING_SECONDS = 60;
/** The maximum number of samples of one recording. */
export const MAX_SAMPLES = SPEECH_SAMPLE_RATE * MAX_RECORDING_SECONDS;

/**
 * Converts samples of the microphone into the rate of the speech engine.
 *
 * The conversion is a linear interpolation: the result is close enough
 * for a speech engine and it needs no native code. The class keeps the
 * state between the blocks, so the output is continuous.
 */
export class LinearResampler {
  private readonly ratio: number;
  /** The samples of the input that are not consumed yet. */
  private pending: number[] = [];
  /** The absolute index of the first pending sample. */
  private base = 0;
  /** The absolute position in the input that the next output uses. */
  private position = 0;

  /**
   * @param fromRate The rate of the microphone.
   * @param toRate The rate that is wanted (16 kHz).
   */
  constructor(
    fromRate: number,
    toRate: number = SPEECH_SAMPLE_RATE,
  ) {
    this.ratio = fromRate / toRate;
  }

  /**
   * Converts a block of samples.
   *
   * @param input The samples of the microphone.
   * @returns The converted samples (16 bit, signed).
   */
  push(input: Float32Array): Int16Array {
    for (const sample of input) {
      this.pending.push(sample);
    }
    const output: number[] = [];
    const end = this.base + this.pending.length;
    for (;;) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const a = this.pending[index - this.base];
      const b = this.pending[index - this.base + 1];
      if (a === undefined || b === undefined || index + 1 >= end) {
        break;
      }
      output.push(a + (b - a) * fraction);
      this.position += this.ratio;
    }
    // The consumed samples are dropped, so the memory stays small.
    const consumed = Math.floor(this.position) - this.base;
    if (consumed > 0) {
      this.pending = this.pending.slice(consumed);
      this.base += consumed;
    }
    return Int16Array.from(output, (value) =>
      Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
    );
  }
}

/** The result of a recording. */
export interface CaptureResult {
  /** The samples (16 kHz, mono, 16 bit signed). */
  samples: Int16Array;
  /** The length of the recording (seconds). */
  seconds: number;
  /** True when the recording was stopped because it was too long. */
  truncated: boolean;
}

/** The reason why a recording failed. */
export class CaptureError extends Error {
  constructor(
    message: string,
    /** The code of the failure ("denied", "no-device", "busy", …). */
    readonly code: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * Records the microphone of the machine.
 *
 * The class is only used by the renderer; it holds no reference to the
 * browser API in its type, so the parts that can be tested are testable.
 */
export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private resampler: LinearResampler | null = null;
  private readonly chunks: Int16Array[] = [];
  private sampleCount = 0;
  private truncated = false;

  /** True while the microphone is open. */
  get recording(): boolean {
    return this.stream !== null;
  }

  /** The number of samples that were recorded. */
  get samples(): number {
    return this.sampleCount;
  }

  /**
   * Opens the microphone.
   *
   * @param maxSeconds The maximum length of the recording.
   * @throws CaptureError when the microphone is not available.
   */
  async start(maxSeconds = MAX_RECORDING_SECONDS): Promise<void> {
    if (this.stream !== null) {
      return;
    }
    const media = globalThis.navigator?.mediaDevices;
    if (media === undefined) {
      throw new CaptureError(
        'This build cannot record the microphone.',
        'unsupported',
      );
    }
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (error) {
      throw new CaptureError(describeMediaError(error), mediaErrorCode(error));
    }
    this.stream = stream;

    const AudioContextCtor =
      globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioContextCtor === undefined) {
      this.closeStream();
      throw new CaptureError(
        'This build cannot record the microphone.',
        'unsupported',
      );
    }
    const context = new AudioContextCtor();
    this.context = context;
    const source = context.createMediaStreamSource(stream);
    // The processor runs on the thread of the renderer; the work per block
    // is a copy of a few thousand samples, so the panel stays responsive.
    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    this.resampler = new LinearResampler(context.sampleRate);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const converted = this.resampler?.push(input) ?? new Int16Array(0);
      if (converted.length === 0) {
        return;
      }
      this.chunks.push(converted);
      this.sampleCount += converted.length;
      if (this.sampleCount >= SPEECH_SAMPLE_RATE * maxSeconds) {
        this.truncated = true;
        void this.stop();
      }
    };
    source.connect(processor);
    // The processor has to be connected to the output to run; the gain of
    // zero keeps the microphone silent for the user.
    const gain = context.createGain();
    gain.gain.value = 0;
    processor.connect(gain);
    gain.connect(context.destination);
  }

  /**
   * Stops the recording and returns the samples.
   *
   * The microphone is released, even when the recording failed.
   */
  async stop(): Promise<CaptureResult> {
    this.closeStream();
    const total = this.sampleCount;
    const samples = new Int16Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks.length = 0;
    this.sampleCount = 0;
    return {
      samples,
      seconds: total / SPEECH_SAMPLE_RATE,
      truncated: this.truncated,
    };
  }

  /** Stops the recording without keeping the samples. */
  cancel(): void {
    this.closeStream();
    this.chunks.length = 0;
    this.sampleCount = 0;
    this.truncated = false;
  }

  /** Releases the microphone and the audio context. */
  private closeStream(): void {
    if (this.processor !== null) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // The context may already be closed.
      }
      this.processor = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context !== null) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.resampler = null;
  }
}

/** The message of a failed microphone request. */
export function describeMediaError(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The microphone was not allowed. Allow it for NOVA IDE and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this machine.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is busy — another program is using it.';
    case 'OverconstrainedError':
      return 'The microphone does not support the requested format.';
    case 'AbortError':
      return 'The microphone was stopped while it was opened.';
    default:
      return 'The microphone could not be opened.';
  }
}

/** The code of a failed microphone request. */
export function mediaErrorCode(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    default:
      return 'unknown';
  }
}
