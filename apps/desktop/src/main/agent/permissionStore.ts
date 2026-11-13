/**
 * The permission preferences of the user (spec §12.3, §18.8).
 *
 * The preferences live in the main process and are stored as plain JSON
 * in the user data directory — the same approach the provider settings
 * use. The renderer only ever sees the effective categories; it cannot
 * write the file and it cannot widen a permission on its own (the main
 * process asks the user with a native dialog first).
 *
 * `system` is not a category: an operation outside the workspace is
 * refused before these settings are consulted.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentPermissionCategory,
  AgentPermissionConfig,
  AgentPermissionView,
} from '../../shared/agent-types';
import { DEFAULT_AGENT_PERMISSION_CONFIG } from '../../shared/agent-types';
import { errnoOf } from '../services/results';
import { permissionLevels, type AgentPermissionSettings } from './permissions';

/** The name of the settings file in the user data directory. */
const SETTINGS_FILE_NAME = 'agent-permissions.json';

/** The shape of the file on disk. */
interface PermissionSettingsFile extends AgentPermissionConfig {
  version: 1;
  allowCloudContext: boolean;
}

/**
 * The persistent permission preferences.
 *
 * A corrupted or hand-edited file never widens a permission: every
 * value that is not a boolean falls back to the default.
 */
export class PermissionSettingsStore {
  private current: AgentPermissionConfig = { ...DEFAULT_AGENT_PERMISSION_CONFIG };
  private allowCloudContext = false;
  private loading: Promise<void> | null = null;

  /** The path of the settings file. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
  }

  /** Loads the file once (a second call reuses the promise). */
  async load(): Promise<void> {
    if (this.loading === null) {
      this.loading = this.read();
    }
    await this.loading;
  }

  /** The settings in force (for the panel). */
  async view(): Promise<AgentPermissionView> {
    await this.load();
    return this.currentView();
  }

  /** The settings in force, without waiting for the disk. */
  currentView(): AgentPermissionView {
    return {
      current: { ...this.current },
      defaults: { ...DEFAULT_AGENT_PERMISSION_CONFIG },
      allowCloudContext: this.allowCloudContext,
    };
  }

  /**
   * True when setting the category to `allowed` would widen the policy.
   *
   * Widening needs an explicit confirmation of the user; narrowing is
   * always free.
   */
  isWidening(category: AgentPermissionCategory, allowed: boolean): boolean {
    return allowed && this.current[category] !== true;
  }

  /** Applies a change (the caller already confirmed a widening). */
  async setCategory(
    category: AgentPermissionCategory,
    allowed: boolean,
  ): Promise<void> {
    await this.load();
    this.current = { ...this.current, [category]: allowed };
    await this.save();
  }

  /**
   * Copies the settings into the object the agent service holds.
   *
   * The object is mutated in place on purpose: the tool context keeps a
   * reference to it, so a change takes effect for the following tool
   * calls of a run without restarting anything.
   */
  applyTo(settings: AgentPermissionSettings): void {
    const levels = permissionLevels(this.current);
    settings.allowedLevels.splice(0, settings.allowedLevels.length, ...levels);
    settings.allowCloudContext = this.allowCloudContext;
  }

  /** Reads and checks the file. */
  private async read(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.applyParsed(JSON.parse(raw) as unknown);
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        console.error('[agent] could not read the permission settings', error);
      }
    }
  }

  /** Writes the file (a failure is logged, never thrown at the user). */
  private async save(): Promise<void> {
    const file: PermissionSettingsFile = {
      version: 1,
      ...this.current,
      allowCloudContext: this.allowCloudContext,
    };
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
    } catch (error) {
      console.error('[agent] could not write the permission settings', error);
    }
  }

  /** Accepts only well-formed values; anything else keeps the default. */
  private applyParsed(parsed: unknown): void {
    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }
    const record = parsed as Record<string, unknown>;
    const next: AgentPermissionConfig = { ...DEFAULT_AGENT_PERMISSION_CONFIG };
    for (const category of ['read', 'workspace', 'command'] as const) {
      if (typeof record[category] === 'boolean') {
        next[category] = record[category];
      }
    }
    this.current = next;
    this.allowCloudContext = record.allowCloudContext === true;
  }
}
