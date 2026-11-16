/**
 * The defaults of the local models (spec §11.3, §20).
 *
 * The user chooses a model for the chat and a model for the agent. The
 * choice is stored as plain JSON in the user data directory — the same
 * approach the settings of the providers use: a handful of small
 * records that can be read, checked and written atomically.
 *
 * Only the *name* of a model is stored. Nothing else about the model
 * is cached, so a model that was removed in the meantime is simply not
 * found any more.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LocalModelDefaults } from '../../../shared/local-model-types';
import { validateModelName } from './modelNames';

/** The name of the file in the user data directory. */
const DEFAULTS_FILE_NAME = 'local-model-defaults.json';

/** The content of the file. */
export interface LocalModelDefaultsFile {
  version: 1;
  defaults: LocalModelDefaults;
}

/** The defaults when the user did not choose anything yet. */
export function emptyModelDefaults(): LocalModelDefaults {
  return { chatModel: '', agentModel: '' };
}

export class ModelDefaultsStore {
  private cache: LocalModelDefaults | null = null;

  /** The path of the file in the user data directory. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), DEFAULTS_FILE_NAME);
  }

  /** The defaults (read from the disk on first use). */
  async load(): Promise<LocalModelDefaults> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeDefaults(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(
          '[models] could not read the defaults of the models',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      this.cache = emptyModelDefaults();
    }
    return this.cache;
  }

  /** The defaults that are stored right now. */
  async get(): Promise<LocalModelDefaults> {
    return this.load();
  }

  /**
   * Stores the defaults and writes the file.
   *
   * A name that is not valid is ignored: the defaults of the panel
   * must never contain something that could not be sent to Ollama.
   */
  async set(changes: Partial<LocalModelDefaults>): Promise<LocalModelDefaults> {
    const current = await this.load();
    const next: LocalModelDefaults = {
      chatModel: this.sanitizeModel(changes.chatModel ?? current.chatModel),
      agentModel: this.sanitizeModel(changes.agentModel ?? current.agentModel),
    };
    const file: LocalModelDefaultsFile = { version: 1, defaults: next };
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
      this.cache = next;
    } catch (error) {
      console.error(
        '[models] could not write the defaults of the models',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    return next;
  }

  /** Keeps a name only when it is a valid model name. */
  private sanitizeModel(model: string): string {
    if (typeof model !== 'string' || model.length === 0) {
      return '';
    }
    return validateModelName(model) === null ? model : '';
  }
}

/**
 * Accepts only well-formed defaults (the file could be corrupted or
 * edited by hand).
 */
function sanitizeDefaults(parsed: unknown): LocalModelDefaults {
  if (typeof parsed !== 'object' || parsed === null) {
    return emptyModelDefaults();
  }
  const defaults = (parsed as { defaults?: unknown }).defaults;
  if (typeof defaults !== 'object' || defaults === null) {
    return emptyModelDefaults();
  }
  const record = defaults as { chatModel?: unknown; agentModel?: unknown };
  const chatModel =
    typeof record.chatModel === 'string' &&
    validateModelName(record.chatModel) === null
      ? record.chatModel
      : '';
  const agentModel =
    typeof record.agentModel === 'string' &&
    validateModelName(record.agentModel) === null
      ? record.agentModel
      : '';
  return { chatModel, agentModel };
}
