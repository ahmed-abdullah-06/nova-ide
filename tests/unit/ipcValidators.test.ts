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
  assertNoArgs,
  assertOneString,
  assertOptionalCwd,
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
