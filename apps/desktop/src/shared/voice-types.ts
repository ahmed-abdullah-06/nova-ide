/**
 * The types of the voice assistant (spec §15, §19).
 *
 * The file is shared by the main process (the voice service), the
 * preload bridge and the renderer (the composer and the settings). It
 * must never import Node.js or Electron runtime APIs so it stays usable
 * in the sandboxed renderer.
 *
 * The rules of the privacy of the voice are part of the contract:
 *
 *  - the audio is recorded in the renderer, but it is only ever sent to
 *    the main process,
 *  - a local engine receives the audio over a pipe, so nothing is
 *    written to the disk,
 *  - a cloud engine needs the approval of the user for *this*
 *    recording, and the local-only mode blocks it completely.
 */

/** The engine that recognises the speech. */
export type SpeechEngine = 'none' | 'local' | 'cloud';

/** The settings of the voice assistant. */
export interface VoiceSettings {
  /** False when the voice assistant is switched off completely. */
  enabled: boolean;
  /** The engine that recognises the speech. */
  engine: SpeechEngine;
  /** The name of the voice of the operating system (empty = the default). */
  voice: string;
  /** The speed of the speech (0.5 … 2). */
  rate: number;
  /** The key that starts the push-to-talk recording. */
  pushToTalkKey: string;
  /** The path of the local speech engine (an executable). */
  enginePath: string;
  /** The arguments of the local speech engine (`{model}` is replaced). */
  engineArgs: string[];
  /** The speech model that the local engine uses. */
  modelId: string;
  /** The path of the speech model file on the disk. */
  modelPath: string;
  /** The maximum length of one recording (seconds). */
  maxRecordingSeconds: number;
  /** True when the code blocks of an answer are read aloud too. */
  readCodeBlocks: boolean;
}

/** The settings of the voice assistant when nothing was changed yet. */
export function defaultVoiceSettings(): VoiceSettings {
  return {
    enabled: false,
    engine: 'none',
    voice: '',
    rate: 1,
    pushToTalkKey: 'F8',
    enginePath: '',
    engineArgs: ['-m', '{model}', '-f', '-', '-nt'],
    modelId: '',
    modelPath: '',
    maxRecordingSeconds: 60,
    readCodeBlocks: false,
  };
}

/** The result of a recognition. */
export interface VoiceTranscript {
  /** The recognised text. */
  text: string;
  /** The length of the audio (seconds). */
  seconds: number;
  /** True when the recording hit the limit of its length. */
  truncated: boolean;
  /** True when the engine reported an error. */
  error?: string;
}

/** The reason why a voice operation was refused. */
export type VoiceErrorCode =
  | 'disabled'
  | 'no-engine'
  | 'no-model'
  | 'no-session'
  | 'busy'
  | 'too-large'
  | 'too-short'
  | 'timeout'
  | 'local-only'
  | 'not-approved'
  | 'cancelled'
  | 'failed';

/** The outcome of a voice operation (never a thrown error). */
export type VoiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: VoiceErrorCode; message: string };

/** The maximum length of one recording (seconds). */
export const MAX_RECORDING_SECONDS = 60;
/** The shortest recording that is sent to an engine (seconds). */
export const MIN_RECORDING_SECONDS = 0.3;
/** The maximum number of bytes of one recording (16 kHz, mono, 16 bit). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
/** The sample rate that the speech engines expect. */
export const SPEECH_SAMPLE_RATE = 16000;
/** The maximum length of the transcript that is returned. */
export const MAX_TRANSCRIPT_CHARS = 8000;
/** The maximum number of bytes of the output of an engine. */
export const MAX_ENGINE_OUTPUT_BYTES = 64 * 1024;
/** How long one recognition may take (milliseconds). */
export const TRANSCRIPTION_TIMEOUT_MS = 120_000;
/** The maximum length of the push-to-talk key text. */
export const MAX_PUSH_TO_TALK_CHARS = 64;
