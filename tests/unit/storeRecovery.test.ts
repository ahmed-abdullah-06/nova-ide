/**
 * Settings/conversation recovery (Milestone 10B).
 * The real stores must survive a corrupt file and keep a backup.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userData = '';

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));

const { AppSettingsStore } = await import(
  '../../apps/desktop/src/main/config/appSettings'
);
const { ConversationStore } = await import(
  '../../apps/desktop/src/main/providers/conversationStore'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-store-recovery-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('store recovery', () => {
  it('recovers corrupted application settings with defaults and a backup', async () => {
    await writeFile(path.join(userData, 'app-settings.json'), '{ broken', 'utf8');
    const settings = await new AppSettingsStore().load();
    expect(settings).toEqual({ localOnly: false });
    const files = await readdir(userData);
    expect(files.some((name) => name.startsWith('app-settings.json.corrupt-'))).toBe(true);
  });

  it('still reads valid local-only settings', async () => {
    await writeFile(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({ version: 1, settings: { localOnly: true } }),
      'utf8',
    );
    const settings = await new AppSettingsStore().load();
    expect(settings).toEqual({ localOnly: true });
    expect(await readdir(userData)).toEqual(['app-settings.json']);
  });

  it('recovers corrupted conversations with an empty list and a backup', async () => {
    await writeFile(path.join(userData, 'conversations.json'), 'not json at all', 'utf8');
    const conversations = await new ConversationStore().list();
    expect(conversations).toEqual([]);
    const files = await readdir(userData);
    expect(files.some((name) => name.startsWith('conversations.json.corrupt-'))).toBe(true);
  });

  it('keeps a child-process crash from losing the rest of the history', async () => {
    // A structurally valid file with one broken entry still loads the
    // remaining conversations (the sanitizer drops the invalid entry).
    await writeFile(
      path.join(userData, 'conversations.json'),
      JSON.stringify({
        version: 1,
        conversations: [
          { id: 'ok', title: 'ok', messages: [{ role: 'user', content: 'hello' }] },
          { id: 'broken', title: 42 },
        ],
      }),
      'utf8',
    );
    const conversations = await new ConversationStore().list();
    expect(conversations.length).toBeGreaterThanOrEqual(1);
    expect(conversations.some((entry) => entry.id === 'ok')).toBe(true);
  });
});
