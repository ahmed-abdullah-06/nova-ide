/**
 * Tests for the local-only mode (spec §14.3, §19.4, §20).
 *
 * The mode is a switch in the main process: while it is on, no cloud
 * provider and no cloud voice service may be used — not even with the
 * approval of the user, and not even if the renderer asks for it.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The directory the store writes into. */
let userData = '';

/** The mocked Electron module. */
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const { AppSettingsStore, defaultAppSettings } = await import(
  '../../apps/desktop/src/main/config/appSettings'
);
const { checkPrivacyGate } = await import(
  '../../apps/desktop/src/main/providers/privacy'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-local-only-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('the local-only mode', () => {
  it('is off on a fresh profile', async () => {
    const store = new AppSettingsStore();
    const settings = await store.get();
    expect(settings.localOnly).toBe(false);
    expect(defaultAppSettings().localOnly).toBe(false);
    expect(store.localOnly).toBe(false);
  });

  it('is remembered after a restart', async () => {
    const first = new AppSettingsStore();
    await first.setLocalOnly(true);
    const second = new AppSettingsStore();
    await second.load();
    expect(second.localOnly).toBe(true);
    expect((await second.get()).localOnly).toBe(true);
  });

  it('writes the state to the disk', async () => {
    const store = new AppSettingsStore();
    await store.setLocalOnly(true);
    const raw = await readFile(
      path.join(userData, 'app-settings.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      settings: { localOnly: true },
    });
  });

  it('ignores a file that was edited by hand', async () => {
    const store = new AppSettingsStore();
    await store.setLocalOnly(true);
    // A file that claims something else must not be believed.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({ version: 1, settings: { localOnly: 'yes' } }),
      'utf8',
    );
    const second = new AppSettingsStore();
    await second.load();
    expect(second.localOnly).toBe(false);
  });

  it('survives a broken file', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(userData, 'app-settings.json'),
      'not json',
      'utf8',
    );
    const store = new AppSettingsStore();
    await store.load();
    expect(store.localOnly).toBe(false);
  });
});

describe('the local-only mode blocks the cloud', () => {
  it('refuses a cloud provider', () => {
    const gate = checkPrivacyGate(
      'cloud',
      true,
      true,
      true,
      true,
      true,
    );
    expect(gate).not.toBeNull();
    expect(gate?.message).toContain('local-only mode');
    expect(gate?.code).toBe('disabled');
  });

  it('refuses a cloud provider even without context', () => {
    const gate = checkPrivacyGate('cloud', true, true, false, false, true);
    expect(gate).not.toBeNull();
  });

  it('allows a local provider', () => {
    expect(checkPrivacyGate('local', true, false, false, false, true)).toBeNull();
    expect(checkPrivacyGate('local', true, false, false, true, true)).toBeNull();
  });

  it('changes nothing when the mode is off', () => {
    // Without the mode, the cloud behaves like before.
    expect(checkPrivacyGate('cloud', true, true, true, true, false)).toBeNull();
    expect(checkPrivacyGate('cloud', false, true, true, true, false)).not.toBeNull();
  });

  it('cannot be bypassed by the approval of the user', () => {
    // The approval of the user is not enough while the mode is on.
    const withApproval = checkPrivacyGate('cloud', true, true, true, true, true);
    const withoutApproval = checkPrivacyGate('cloud', true, true, false, true, true);
    expect(withApproval?.message).toBe(withoutApproval?.message);
  });
});
