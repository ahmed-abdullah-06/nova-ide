/**
 * The settings of the voice assistant (spec §15.3, Milestone 8).
 *
 * The settings live in the main process. The renderer may read them and
 * change them through a validated channel — it can never inject a path or
 * an argument that bypasses the sanitizer here.
 *
 * The file is `voice-settings.json` in the user data directory. A value
 * that does not pass the sanitizer falls back to its default, so a hand
 * edited file cannot widen the risk.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parsePushToTalkKey } from '../../shared/pushToTalk';
import {
  defaultVoiceSettings,
  MAX_PUSH_TO_TALK_CHARS,
  type SpeechEngine,
  type VoiceSettings,
} from '../../shared/voice-types';

/** The name of the file in the user data directory. */
const SETTINGS_FILE_NAME = 'voice-settings.json';

/** The largest value of `maxRecordingSeconds` that is accepted. */
export const MAX_SETTING_SECONDS = 120;
/** The smallest value of `maxRecordingSeconds` that is accepted. */
export const MIN_SETTING_SECONDS = 5;

/** The engines that the settings accept. */
const ENGINES: readonly SpeechEngine[] = ['none', 'local', 'cloud'];

/** A string of bounded length (or the fallback). */
function boundedString(value: unknown, limit: number, fallback: string): string {
  return typeof value === 'string' && value.length <= limit ? value : fallback;
}

/** A finite number within a range (or the fallback). */
function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

/** The arguments of the engine (bounded count and length). */
function boundedArgs(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 16) {
    return [...fallback];
  }
  if (!value.every((entry) => typeof entry === 'string' && entry.length <= 512)) {
    return [...fallback];
  }
  return value.map((entry) => entry as string);
}

/**
 * Reads the settings of the voice assistant from an unknown value.
 *
 * Every field is checked on its own; a broken field does not discard the
 * rest.
 */
export function sanitizeVoiceSettings(input: unknown): VoiceSettings {
  const defaults = defaultVoiceSettings();
  if (typeof input !== 'object' || input === null) {
    return defaults;
  }
  const source = input as Record<string, unknown>;
  const engine = ENGINES.includes(source.engine as SpeechEngine)
    ? (source.engine as SpeechEngine)
    : defaults.engine;
  const pushToTalkKey = boundedString(
    source.pushToTalkKey,
    MAX_PUSH_TO_TALK_CHARS,
    defaults.pushToTalkKey,
  );
  return {
    enabled: source.enabled === true,
    engine,
    voice: boundedString(source.voice, 200, defaults.voice),
    rate: Math.round(boundedNumber(source.rate, 0.5, 2, defaults.rate) * 100) / 100,
    pushToTalkKey:
      parsePushToTalkKey(pushToTalkKey) !== null
        ? pushToTalkKey
        : defaults.pushToTalkKey,
    enginePath: boundedString(source.enginePath, 1024, defaults.enginePath),
    engineArgs: boundedArgs(source.engineArgs, defaults.engineArgs),
    modelId: boundedString(source.modelId, 64, defaults.modelId),
    modelPath: boundedString(source.modelPath, 1024, defaults.modelPath),
    maxRecordingSeconds: Math.round(
      boundedNumber(
        source.maxRecordingSeconds,
        MIN_SETTING_SECONDS,
        MAX_SETTING_SECONDS,
        defaults.maxRecordingSeconds,
      ),
    ),
    readCodeBlocks: source.readCodeBlocks === true,
  };
}

/**
 * Checks the paths of the settings before they are stored.
 *
 * A path that the user typed by hand must be absolute, so the engine is
 * never looked up in the working directory of the application (which an
 * attacker may control). The existence is checked again when a recording
 * is recognised: a file that disappears in the meantime is refused there.
 *
 * @returns The message of the first invalid path, or null when both are
 * acceptable.
 */
export function validateVoicePaths(settings: VoiceSettings): string | null {
  for (const [label, value] of [
    ['engine', settings.enginePath],
    ['model', settings.modelPath],
  ] as const) {
    if (value.length > 0 && !path.isAbsolute(value)) {
      return `The path of the ${label} must be absolute.`;
    }
  }
  return null;
}

/** The store of the voice settings. */
export class VoiceSettingsStore {
  private cache: VoiceSettings | null = null;

  /** The path of the file in the user data directory. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
  }

  /** The settings (read from the disk on first use). */
  async load(): Promise<VoiceSettings> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeVoiceSettings(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(
          '[voice] could not read the voice settings',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      this.cache = defaultVoiceSettings();
    }
    return this.cache;
  }

  /** The settings that are stored right now. */
  async get(): Promise<VoiceSettings> {
    return this.load();
  }

  /** Stores the settings (already sanitized). */
  async save(input: unknown): Promise<VoiceSettings> {
    const next = sanitizeVoiceSettings(input);
    const file = { version: 1, settings: next };
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
      this.cache = next;
    } catch (error) {
      console.error(
        '[voice] could not write the voice settings',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    return next;
  }
}
