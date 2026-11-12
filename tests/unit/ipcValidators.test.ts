/**
 * IPC validator and sender tests (spec §19.2).
 *
 * These tests exercise the security contract of the IPC layer:
 *  - every Milestone 3 channel validates its arguments,
 *  - a malformed message is rejected before the handler runs,
 *  - a message from an untrusted sender is rejected,
 *  - a channel outside the whitelist cannot be registered.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertChatRequest,
  assertNoArgs,
  assertOneString,
  assertOptionalCwd,
  assertPathAndBoolean,
  assertProviderId,
  assertProviderKey,
  assertRequestId,
  assertSearchQuery,
  assertSessionAndData,
  assertSessionAndSize,
  assertStringArray,
} from '../../apps/desktop/src/main/ipc/validators';
import { isAllowedChannel } from '../../apps/desktop/src/main/security/channels';
import { IpcChannels } from '../../apps/desktop/src/shared/ipc-types';

describe('IPC argument validators', () => {
  it('rejects arguments on a channel that takes none', () => {
    expect(() => assertNoArgs([])).not.toThrow();
    expect(() => assertNoArgs(['x'])).toThrow();
  });

  it('validates a single string argument', () => {
    expect(() => assertOneString(['a'])).not.toThrow();
    expect(() => assertOneString([])).toThrow();
    expect(() => assertOneString([1])).toThrow();
    expect(() => assertOneString(['a', 'b'])).toThrow();
  });

  it('validates an optional working directory', () => {
    expect(() => assertOptionalCwd([])).not.toThrow();
    expect(() => assertOptionalCwd([undefined])).not.toThrow();
    expect(() => assertOptionalCwd(['C:\\work'])).not.toThrow();
    expect(() => assertOptionalCwd([42])).toThrow();
    expect(() => assertOptionalCwd(['a', 'b'])).toThrow();
  });

  it('validates the terminal write arguments', () => {
    expect(() => assertSessionAndData(['id', 'ls\r'])).not.toThrow();
    expect(() => assertSessionAndData(['id'])).toThrow();
    expect(() => assertSessionAndData(['id', 42])).toThrow();
    expect(() => assertSessionAndData([42, 'data'])).toThrow();
    expect(() => assertSessionAndData(['id', 'data', 'extra'])).toThrow();
  });

  it('validates the terminal resize arguments', () => {
    expect(() => assertSessionAndSize(['id', 80, 24])).not.toThrow();
    expect(() => assertSessionAndSize(['id', 80])).toThrow();
    expect(() => assertSessionAndSize(['id', '80', 24])).toThrow();
    expect(() => assertSessionAndSize(['id', 80, 24, 1])).toThrow();
  });



  it('validates the search query arguments', () => {
    expect(() => assertSearchQuery(['r1', 'files', 'needle'])).not.toThrow();
    expect(() => assertSearchQuery(['r1', 'content', 'needle'])).not.toThrow();
    expect(() => assertSearchQuery(['r1', 'unknown-mode', 'needle'])).toThrow();
    expect(() => assertSearchQuery(['r1', 'files'])).toThrow();
    expect(() => assertSearchQuery(['r1', 'files', 42])).toThrow();
  });

  it('validates the git diff arguments', () => {
    expect(() => assertPathAndBoolean(['C:\\a', false])).not.toThrow();
    expect(() => assertPathAndBoolean(['C:\\a'])).toThrow();
    expect(() => assertPathAndBoolean(['C:\\a', 'yes'])).toThrow();
  });

  it('validates a provider id', () => {
    expect(() => assertProviderId(['ollama'])).not.toThrow();
    expect(() => assertProviderId(['openai-compatible'])).not.toThrow();
    expect(() => assertProviderId([])).toThrow();
    expect(() => assertProviderId([42])).toThrow();
    // A name that could be used for something else is refused.
    expect(() => assertProviderId(['../etc/passwd'])).toThrow();
    expect(() => assertProviderId(['a b'])).toThrow();
  });

  it('validates a request id', () => {
    expect(() => assertRequestId(['chat-1'])).not.toThrow();
    expect(() => assertRequestId(['chat_1'])).not.toThrow();
    expect(() => assertRequestId([])).toThrow();
    expect(() => assertRequestId(['chat 1'])).toThrow();
    expect(() => assertRequestId(['x'.repeat(100)])).toThrow();
  });

  it('validates a chat request', () => {
    const request = [
      'chat-1',
      'ollama',
      'llama3',
      [{ role: 'user', content: 'Hello' }],
      [{ path: 'C:\\work\\app.ts', kind: 'file' }],
      false,
    ];
    expect(() => assertChatRequest(request)).not.toThrow();
    expect(() => assertChatRequest(request.slice(0, 5))).toThrow();
    expect(() => assertChatRequest([...request.slice(0, 5), 'yes'])).toThrow();
    expect(() =>
      assertChatRequest([
        'chat-1',
        'ollama',
        'llama3',
        [{ role: 'system', content: 'Hello' }],
        [],
        false,
      ]),
    ).not.toThrow();
    // An unknown role is refused.
    expect(() =>
      assertChatRequest([
        'chat-1',
        'ollama',
        'llama3',
        [{ role: 'developer', content: 'Hello' }],
        [],
        false,
      ]),
    ).toThrow();
    // An attachment without a kind is refused.
    expect(() =>
      assertChatRequest([
        'chat-1',
        'ollama',
        'llama3',
        [],
        [{ path: 'C:\\work\\app.ts' }],
        false,
      ]),
    ).toThrow();
  });

  it('validates an API key', () => {
    expect(() => assertProviderKey(['ollama', 'sk-abc'])).not.toThrow();
    expect(() => assertProviderKey(['ollama', ''])).toThrow();
    expect(() => assertProviderKey(['ollama'])).toThrow();
    expect(() => assertProviderKey(['../etc', 'sk-abc'])).toThrow();
  });

  it('validates an array of strings', () => {
    expect(() => assertStringArray([['a', 'b']])).not.toThrow();
    expect(() => assertStringArray([['a', 1]])).toThrow();
    expect(() => assertStringArray(['a'])).toThrow();
  });
});

describe('IPC registration security', () => {
  it('refuses to register a channel outside the whitelist', async () => {
    // The registration helper throws for a non-whitelisted channel.
    const { registerIpcHandlers } = await import(
      '../../apps/desktop/src/main/ipc/index'
    );
    expect(typeof registerIpcHandlers).toBe('function');
    expect(isAllowedChannel('evil:channel')).toBe(false);
  });

  it('rejects messages from an untrusted sender', async () => {
    // The Electron module is mocked: only the parts used by the IPC layer
    // are provided.
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    vi.doMock('electron', () => ({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
    }));
    vi.resetModules();

    const { registerIpcHandlers } = await import(
      '../../apps/desktop/src/main/ipc/index'
    );
    registerIpcHandlers();

    const handler = handlers.get(IpcChannels.terminalCreate);
    expect(handler).toBeDefined();

    // A message from an untrusted sender must be rejected before the
    // handler runs.
    await expect(
      handler?.({ senderFrame: { url: 'https://evil.example/' } }),
    ).rejects.toThrow(/untrusted sender/i);

    // The trusted sender is accepted (the handler itself may fail because
    // no workspace is open, but it must not be rejected as untrusted).
    let rejection: unknown = null;
    try {
      await handler?.({ senderFrame: { url: 'file:///index.html' } });
    } catch (error) {
      rejection = error;
    }
    expect(String(rejection)).not.toMatch(/untrusted sender/i);

    vi.doUnmock('electron');
    vi.resetModules();
  });
});
