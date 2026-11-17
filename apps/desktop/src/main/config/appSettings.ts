/**
 * The global settings of the application (spec §20, §14.3, §19.4).
 *
 * The local-only mode is a switch that blocks every cloud provider and
 * every cloud voice service **in the main process**, no matter what the
 * renderer asks for. The renderer can only read the state and switch it
 * on or off; it can never bypass the rule for a single request.
 *
 * The settings are stored as plain JSON in the user data directory — the
 * same approach the settings of the providers use.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The name of the file in the user data directory. */
const SETTINGS_FILE_NAME = 'app-settings.json';

/** The global settings of the application. */
export interface AppSettings {
  /**
   * True when nothing may leave this machine.
   *
   * Every cloud provider and every cloud voice service is refused while
   * the mode is on.
   */
  localOnly: boolean;
}

/** The settings of a fresh installation. */
export function defaultAppSettings(): AppSettings {
  // The local-only mode is off by default: the user decides whether the
  // cloud may be used at all.
  return { localOnly: false };
}

export class AppSettingsStore {
  private cache: AppSettings | null = null;

  /**
   * The state that is known right now.
   *
   * The privacy gate runs synchronously, so the rule must be readable
   * without waiting for a promise. The value is loaded once at the
   * start of the application and after every change.
   */
  localOnly = false;

  /** The path of the file in the user data directory. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
  }

  /** The settings (read from the disk on first use). */
  async load(): Promise<AppSettings> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeSettings(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(
          '[settings] could not read the settings of the application',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      this.cache = defaultAppSettings();
    }
    this.localOnly = this.cache.localOnly;
    return this.cache;
  }

  /** The settings that are stored right now. */
  async get(): Promise<AppSettings> {
    return this.load();
  }

  /** True when only local services may be used. */
  async isLocalOnly(): Promise<boolean> {
    return (await this.load()).localOnly;
  }

  /**
   * Switches the local-only mode on or off and writes the file.
   *
   * The switch is the only way to change the rule; the renderer cannot
   * ask for an exception.
   */
  async setLocalOnly(enabled: boolean): Promise<AppSettings> {
    const next: AppSettings = { localOnly: enabled === true };
    const file = { version: 1, settings: next };
    this.localOnly = next.localOnly;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
      this.cache = next;
    } catch (error) {
      console.error(
        '[settings] could not write the settings of the application',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    return next;
  }
}

/**
 * Accepts only well-formed settings (the file could be corrupted or
 * edited by hand).
 */
function sanitizeSettings(parsed: unknown): AppSettings {
  if (typeof parsed !== 'object' || parsed === null) {
    return defaultAppSettings();
  }
  const settings = (parsed as { settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) {
    return defaultAppSettings();
  }
  const record = settings as { localOnly?: unknown };
  return { localOnly: record.localOnly === true };
}
