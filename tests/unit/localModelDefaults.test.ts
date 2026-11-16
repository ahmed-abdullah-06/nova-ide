/**
 * Tests for the defaults of the local models (spec §11.3, §20).
 *
 * The defaults are stored as plain JSON in the user data directory —
 * the same approach the settings of the providers use. The tests write
 * into a temporary directory, never into the profile of the user.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const { ModelDefaultsStore } = await import(
  '../../apps/desktop/src/main/providers/localModels/modelDefaultsStore'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-model-defaults-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('the defaults of the local models', () => {
  it('is empty on a fresh profile', async () => {
    const store = new ModelDefaultsStore();
    const defaults = await store.get();
    expect(defaults).toEqual({ chatModel: '', agentModel: '' });
  });

  it('stores the model of the chat and of the agent', async () => {
    const store = new ModelDefaultsStore();
    await store.set({ chatModel: 'qwen2.5:7b', agentModel: 'qwen2.5:7b' });
    const raw = await readFile(
      path.join(userData, 'local-model-defaults.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      defaults: { chatModel: 'qwen2.5:7b', agentModel: 'qwen2.5:7b' },
    });
  });

  it('reads the defaults again after a restart', async () => {
    const first = new ModelDefaultsStore();
    await first.set({ chatModel: 'qwen2.5:7b', agentModel: '' });
    const second = new ModelDefaultsStore();
    const defaults = await second.get();
    expect(defaults.chatModel).toBe('qwen2.5:7b');
    expect(defaults.agentModel).toBe('');
  });

  it('only changes the value that was set', async () => {
    const store = new ModelDefaultsStore();
    await store.set({ chatModel: 'a:1', agentModel: 'b:2' });
    const updated = await store.set({ agentModel: 'c:3' });
    expect(updated.chatModel).toBe('a:1');
    expect(updated.agentModel).toBe('c:3');
  });

  it('never stores a name that is not a model name', async () => {
    const store = new ModelDefaultsStore();
    const updated = await store.set({
      chatModel: 'http://example.com/model',
      agentModel: '../../etc/passwd',
    });
    expect(updated.chatModel).toBe('');
    expect(updated.agentModel).toBe('');
  });

  it('ignores a file that was edited by hand', async () => {
    await writeFile(
      path.join(userData, 'local-model-defaults.json'),
      JSON.stringify({
        version: 1,
        defaults: { chatModel: 'http://example.com/m', agentModel: 42 },
      }),
      'utf8',
    );
    const store = new ModelDefaultsStore();
    const defaults = await store.get();
    expect(defaults.chatModel).toBe('');
    expect(defaults.agentModel).toBe('');
  });

  it('survives a broken file', async () => {
    await writeFile(
      path.join(userData, 'local-model-defaults.json'),
      'not json',
      'utf8',
    );
    const store = new ModelDefaultsStore();
    const defaults = await store.get();
    expect(defaults).toEqual({ chatModel: '', agentModel: '' });
  });
});
