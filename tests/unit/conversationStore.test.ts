/**
 * Tests for the conversations of the chat (spec §10.7).
 *
 * The store writes plain JSON into the user data directory; the tests
 * use a temporary directory instead.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredConversation } from '../../apps/desktop/src/shared/ai-types';

/** The directory the store writes into. */
let userData = '';

/** The mocked Electron module. */
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const { ConversationStore } = await import(
  '../../apps/desktop/src/main/providers/conversationStore'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-conversations-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

/** A conversation for the tests. */
function conversation(overrides: Partial<StoredConversation> = {}): StoredConversation {
  return {
    id: 'conv-1',
    title: 'A question',
    providerId: 'ollama',
    model: 'llama3',
    workspaceRoot: 'C:\\work',
    messages: [{ role: 'user', content: 'Hello' }],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('conversation store', () => {
  it('stores a conversation and reads it back', async () => {
    const store = new ConversationStore();
    await store.save(conversation());
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('conv-1');
    expect(list[0]?.messages[0]?.content).toBe('Hello');
  });

  it('writes plain JSON into the user data directory', async () => {
    const store = new ConversationStore();
    await store.save(conversation());
    const raw = await readFile(
      path.join(userData, 'conversations.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { conversations: StoredConversation[] };
    expect(parsed.conversations).toHaveLength(1);
  });

  it('never stores an API key', async () => {
    const store = new ConversationStore();
    await store.save(
      conversation({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      }),
    );
    const raw = await readFile(
      path.join(userData, 'conversations.json'),
      'utf8',
    );
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('sk-');
  });

  it('replaces a conversation with the same id', async () => {
    const store = new ConversationStore();
    await store.save(conversation());
    await store.save(conversation({ title: 'Another title' }));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Another title');
  });

  it('removes a conversation', async () => {
    const store = new ConversationStore();
    await store.save(conversation());
    await store.remove('conv-1');
    expect(await store.list()).toHaveLength(0);
  });

  it('ignores a corrupted file', async () => {
    await writeFile(
      path.join(userData, 'conversations.json'),
      '{ not json',
      'utf8',
    );
    const store = new ConversationStore();
    expect(await store.list()).toEqual([]);
  });

  it('ignores a broken conversation', async () => {
    await writeFile(
      path.join(userData, 'conversations.json'),
      JSON.stringify({
        version: 1,
        conversations: [
          { id: 'ok', title: 'Fine', messages: [] },
          { title: 'no id' },
          { id: 'bad-message', messages: [{ role: 'developer', content: 'x' }] },
        ],
      }),
      'utf8',
    );
    const store = new ConversationStore();
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.every((entry) => entry.id.length > 0)).toBe(true);
    // The message with an unknown role is dropped.
    const broken = list.find((entry) => entry.id === 'bad-message');
    expect(broken?.messages).toHaveLength(0);
  });

  it('caps the number of conversations', async () => {
    const store = new ConversationStore();
    for (let index = 0; index < 60; index += 1) {
      await store.save(
        conversation({ id: `conv-${index}`, updatedAt: index }),
      );
    }
    const list = await store.list();
    expect(list.length).toBeLessThanOrEqual(50);
  });

  it('caps the number of messages of a conversation', async () => {
    const store = new ConversationStore();
    const messages = Array.from({ length: 250 }, (_value, index) => ({
      role: 'user' as const,
      content: `message ${index}`,
    }));
    await store.save(conversation({ messages }));
    const list = await store.list();
    expect(list[0]?.messages.length).toBeLessThanOrEqual(200);
  });

  it('shortens a title that is too long', async () => {
    const store = new ConversationStore();
    await store.save(conversation({ title: 'x'.repeat(500) }));
    const list = await store.list();
    expect(list[0]?.title.length).toBeLessThanOrEqual(120);
  });
});
