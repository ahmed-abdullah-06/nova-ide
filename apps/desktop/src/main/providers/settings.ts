/**
 * The settings of the providers (spec §11.4).
 *
 * The settings are stored as plain JSON in the user data directory — the
 * same approach the recent workspaces use. SQLite is not needed: the data
 * is a handful of small records, and the whole file can be read, checked
 * and written atomically.
 *
 * The file never contains a plaintext key: the key is encrypted with the
 * operating system (see `credentials.ts`) and only the main process can
 * decrypt it.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { errnoOf } from '../services/results';
import { DEFAULT_OLLAMA_URL } from './urlPolicy';

/** The name of the settings file in the user data directory. */
const SETTINGS_FILE_NAME = 'providers.json';

/** The settings of one provider. */
export interface ProviderSettings {
  /** The id of the provider. */
  id: string;
  /** False when the user switched the provider off. */
  enabled: boolean;
  /** The address of the service. */
  baseUrl: string;
  /**
   * The encrypted API key (base64) — the main process is the only one
   * that can decrypt it, and it never leaves the process.
   */
  encryptedKey: string | null;
  /**
   * True when the user confirmed an address outside the local machine.
   */
  remoteConfirmed: boolean;
}

/** The settings of every known provider. */
export interface ProviderSettingsFile {
  version: 1;
  providers: ProviderSettings[];
}

/** The settings a provider starts with. */
export function defaultProviderSettings(id: string): ProviderSettings {
  return {
    id,
    enabled: true,
    baseUrl: id === 'ollama' ? DEFAULT_OLLAMA_URL : '',
    encryptedKey: null,
    remoteConfirmed: false,
  };
}

export class ProviderSettingsStore {
  private cache: Map<string, ProviderSettings> | null = null;

  /** The path of the settings file. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
  }

  /** The settings of every provider (loaded from disk on first use). */
  async load(): Promise<Map<string, ProviderSettings>> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeSettings(JSON.parse(raw));
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        console.error('[providers] could not read the provider settings', error);
      }
      this.cache = new Map();
    }
    return this.cache;
  }

  /** The settings of one provider (null when it is unknown). */
  async get(id: string): Promise<ProviderSettings | null> {
    const settings = await this.load();
    return settings.get(id) ?? null;
  }

  /** Stores the settings of one provider and writes the file. */
  async set(settings: ProviderSettings): Promise<void> {
    const current = await this.load();
    current.set(settings.id, { ...settings });
    await this.save(current);
  }

  /** Removes the settings of one provider. */
  async remove(id: string): Promise<void> {
    const current = await this.load();
    current.delete(id);
    await this.save(current);
  }

  /** Writes the settings to disk. */
  private async save(settings: Map<string, ProviderSettings>): Promise<void> {
    const file: ProviderSettingsFile = {
      version: 1,
      providers: [...settings.values()],
    };
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
      this.cache = settings;
    } catch (error) {
      console.error('[providers] could not write the provider settings', error);
    }
  }
}

/**
 * Accepts only well-formed settings (the file could be corrupted or
 * edited by hand).
 */
function sanitizeSettings(parsed: unknown): Map<string, ProviderSettings> {
  const settings = new Map<string, ProviderSettings>();
  if (typeof parsed !== 'object' || parsed === null) {
    return settings;
  }
  const providers = (parsed as { providers?: unknown }).providers;
  if (!Array.isArray(providers)) {
    return settings;
  }
  for (const entry of providers) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Partial<ProviderSettings>;
    if (typeof record.id !== 'string' || record.id.length === 0) {
      continue;
    }
    settings.set(record.id, {
      id: record.id,
      enabled: record.enabled !== false,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
      encryptedKey:
        typeof record.encryptedKey === 'string' ? record.encryptedKey : null,
      remoteConfirmed: record.remoteConfirmed === true,
    });
  }
  return settings;
}
