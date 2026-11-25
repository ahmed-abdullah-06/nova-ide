/**
 * The controller of the permission preferences (spec §12.3, §18.8).
 *
 * It combines the persistent store with the settings object the agent
 * service holds. Widening a permission can only happen after the user
 * confirmed it in the main process; the renderer never supplies a
 * "confirmed" flag, so it cannot widen the policy by itself.
 */
import type {
  AgentPermissionCategory,
  AgentPermissionView,
} from '../../shared/agent-types';
import type { AgentPermissionSettings } from './permissions';
import type { PermissionSettingsStore } from './permissionStore';

/** What the controller needs. */
export interface PermissionControllerOptions {
  /** The persistent preferences. */
  store: PermissionSettingsStore;
  /** The object the agent service and the tool context share. */
  settings: AgentPermissionSettings;
  /** Asks the user to confirm a widening (a native dialog in the app). */
  confirmWidening: (category: AgentPermissionCategory) => Promise<boolean>;
  /** Asks the user to confirm the session-wide master switch in main. */
  confirmAllowAll: () => Promise<boolean>;
}

/** The outcome of a change. */
export type PermissionUpdateResult =
  | { ok: true; view: AgentPermissionView }
  | { ok: false; cancelled: boolean; message: string };

export class PermissionController {
  private readonly options: PermissionControllerOptions;
  private readonly readyPromise: Promise<void>;

  constructor(options: PermissionControllerOptions) {
    this.options = options;
    // Loading is started right away; every public method waits for it, so
    // the agent can never run with a stale policy.
    this.readyPromise = this.prepare();
  }

  /** Resolves when the stored preferences are in force. */
  async ready(): Promise<void> {
    await this.readyPromise;
  }

  /** The settings in force, including the session-only master switch. */
  async view(): Promise<AgentPermissionView> {
    await this.ready();
    return {
      ...this.options.store.currentView(),
      allowAll: this.options.settings.allowAll,
    };
  }

  /**
   * Turns the session-wide master switch on or off.
   *
   * Enabling always asks the main process to show the confirmation dialog;
   * the renderer cannot send a "confirmed" flag. Disabling is immediate and
   * restores the stored categories. Nothing here is written to disk, so a
   * restart returns to the narrow defaults.
   */
  async setAllowAll(enabled: boolean): Promise<PermissionUpdateResult> {
    await this.ready();
    if (enabled && !this.options.settings.allowAll) {
      const confirmed = await this.options.confirmAllowAll();
      if (!confirmed) {
        return {
          ok: false,
          cancelled: true,
          message: 'Allow all was not enabled.',
        };
      }
    }
    this.options.settings.allowAll = enabled;
    return { ok: true, view: await this.view() };
  }

  /**
   * Changes one category.
   *
   * Narrowing is applied immediately. Widening first asks the user; a
   * cancelled dialog leaves the policy untouched.
   */
  async update(
    category: AgentPermissionCategory,
    allowed: boolean,
  ): Promise<PermissionUpdateResult> {
    await this.ready();
    if (this.options.store.isWidening(category, allowed)) {
      const confirmed = await this.options.confirmWidening(category);
      if (!confirmed) {
        return {
          ok: false,
          cancelled: true,
          message: 'The permission was not changed.',
        };
      }
    }
    await this.options.store.setCategory(category, allowed);
    this.options.store.applyTo(this.options.settings);
    return { ok: true, view: await this.view() };
  }

  /** Loads the file and copies the policy into the shared settings. */
  private async prepare(): Promise<void> {
    await this.options.store.load();
    this.options.store.applyTo(this.options.settings);
  }
}
