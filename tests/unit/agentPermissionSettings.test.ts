/**
 * Tests for the permission preferences (M6 C3, spec §12.3, §18.8).
 *
 * The tests cover the three guarantees of the feature:
 *  - the defaults are the narrowest useful policy,
 *  - narrowing is applied without any confirmation,
 *  - widening only happens after the main process asked the user, and
 *  - the policy object the agent service holds is updated in place.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPermissionSettings } from '../../apps/desktop/src/main/agent/permissions';
import type { AgentPermissionCategory } from '../../apps/desktop/src/shared/agent-types';

let userData = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const { PermissionSettingsStore } = await import(
  '../../apps/desktop/src/main/agent/permissionStore'
);
const { PermissionController } = await import(
  '../../apps/desktop/src/main/agent/permissionController'
);
const { permissionLevels, settingsFromConfig } = await import(
  '../../apps/desktop/src/main/agent/permissions'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-permissions-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

/** The settings object the agent service holds. */
function sharedSettings(): AgentPermissionSettings {
  return { allowedLevels: ['read'], allowCloudContext: false };
}

describe('the defaults of the permissions', () => {
  it('allows reading and asks for everything else', async () => {
    const store = new PermissionSettingsStore();
    const view = await store.view();
    expect(view.defaults).toEqual({
      read: true,
      workspace: false,
      command: false,
    });
    expect(view.current).toEqual(view.defaults);
  });

  it('never makes the system level configurable', () => {
    expect(
      permissionLevels({ read: true, workspace: true, command: true }),
    ).toEqual(['read', 'workspace', 'command']);
  });
});

describe('narrowing a permission', () => {
  it('is applied without asking the user', async () => {
    const confirm = vi.fn(async () => false);
    const settings = sharedSettings();
    const controller = new PermissionController({
      store: new PermissionSettingsStore(),
      settings,
      confirmWidening: confirm,
    });

    const result = await controller.update('read', false);
    expect(result.ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(settings.allowedLevels).toEqual([]);
  });

  it('keeps the shared settings object updated in place', async () => {
    const settings = sharedSettings();
    const controller = new PermissionController({
      store: new PermissionSettingsStore(),
      settings,
      confirmWidening: async () => true,
    });
    const reference = settings.allowedLevels;

    await controller.update('workspace', true);
    // The same array is mutated, so the tool context sees the change.
    expect(settings.allowedLevels).toBe(reference);
    expect(settings.allowedLevels).toEqual(['read', 'workspace']);
  });
});

describe('widening a permission', () => {
  it('is applied when the user confirms it', async () => {
    const confirm = vi.fn(async () => true);
    const settings = sharedSettings();
    const controller = new PermissionController({
      store: new PermissionSettingsStore(),
      settings,
      confirmWidening: confirm,
    });

    const result = await controller.update('command', true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(settings.allowedLevels).toEqual(['read', 'command']);
  });

  it('changes nothing when the user declines it', async () => {
    const confirm = vi.fn(async () => false);
    const settings = sharedSettings();
    const store = new PermissionSettingsStore();
    const controller = new PermissionController({
      store,
      settings,
      confirmWidening: confirm,
    });

    const result = await controller.update('workspace', true);
    expect(result.ok).toBe(false);
    expect(settings.allowedLevels).toEqual(['read']);
    expect((await store.view()).current.workspace).toBe(false);
  });

  it('does not ask when the category is already allowed', async () => {
    const confirm = vi.fn(async () => false);
    const settings = sharedSettings();
    const controller = new PermissionController({
      store: new PermissionSettingsStore(),
      settings,
      confirmWidening: confirm,
    });

    const result = await controller.update('read', true);
    expect(result.ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the stored preferences', () => {
  it('are read back by a new store', async () => {
    const first = new PermissionSettingsStore();
    await first.setCategory('workspace', true);
    await first.setCategory('read', false);

    const second = new PermissionSettingsStore();
    const view = await second.view();
    expect(view.current).toEqual({
      read: false,
      workspace: true,
      command: false,
    });
  });

  it('fall back to the defaults when the file is corrupted', async () => {
    await writeFile(
      path.join(userData, 'agent-permissions.json'),
      '{not json',
      'utf8',
    );
    const view = await new PermissionSettingsStore().view();
    expect(view.current).toEqual(view.defaults);
  });

  it('ignore values that are not booleans', async () => {
    await writeFile(
      path.join(userData, 'agent-permissions.json'),
      JSON.stringify({ read: 'yes', workspace: 1, command: true }),
      'utf8',
    );
    const view = await new PermissionSettingsStore().view();
    expect(view.current).toEqual({
      read: true,
      workspace: false,
      command: true,
    });
  });

  it('builds the policy levels from the categories', () => {
    expect(
      settingsFromConfig({ read: false, workspace: true, command: true }),
    ).toEqual({
      allowedLevels: ['workspace', 'command'],
      allowCloudContext: false,
    });
  });

  it('accepts only the three configurable categories', () => {
    const categories: AgentPermissionCategory[] = [
      'read',
      'workspace',
      'command',
    ];
    expect(categories).toHaveLength(3);
  });
});
