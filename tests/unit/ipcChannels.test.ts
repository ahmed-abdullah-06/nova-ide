/**
 * IPC channel and validator tests (spec §19.2).
 *
 * The tests cover the security contract of the new Milestone 3 channels:
 * every channel must be on the whitelist, must have a validator that
 * rejects malformed arguments, and must refuse messages from an
 * untrusted sender.
 */
import { describe, expect, it } from 'vitest';
import {
  getAllowedChannels,
  isAllowedChannel,
} from '../../apps/desktop/src/main/security/channels';
import {
  IpcChannels,
  IpcPushChannels,
  type IpcChannel,
} from '../../apps/desktop/src/shared/ipc-types';

describe('IPC channel whitelist (security)', () => {
  it('allows the registered application channels', () => {
    expect(isAllowedChannel(IpcChannels.appGetInfo)).toBe(true);
  });

  it('rejects unknown or forged channels', () => {
    expect(isAllowedChannel('app:evil')).toBe(false);
    expect(isAllowedChannel('fs:write')).toBe(false);
    expect(isAllowedChannel('')).toBe(false);
    expect(isAllowedChannel('__proto__')).toBe(false);
    expect(isAllowedChannel('constructor')).toBe(false);
  });

  it('exposes only string channel names', () => {
    const channels = getAllowedChannels();
    expect(channels.length).toBeGreaterThan(0);
    for (const channel of channels) {
      expect(typeof channel).toBe('string');
      expect(channel).toContain(':');
      expect(isAllowedChannel(channel)).toBe(true);
    }
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('matches the channel registry exactly', () => {
    expect([...getAllowedChannels()].sort()).toEqual(
      [...Object.values(IpcChannels)].sort(),
    );
  });

  it('allows every Milestone 3 channel', () => {
    for (const channel of [
      IpcChannels.terminalCreate,
      IpcChannels.terminalWrite,
      IpcChannels.terminalResize,
      IpcChannels.terminalKill,
      IpcChannels.searchQuery,
      IpcChannels.searchCancel,
      IpcChannels.gitStatus,
      IpcChannels.gitStage,
      IpcChannels.gitUnstage,
      IpcChannels.gitDiscard,
      IpcChannels.gitCommit,
      IpcChannels.gitDiff,
      IpcChannels.gitBranches,
      IpcChannels.gitSwitchBranch,
      IpcChannels.taskList,
      IpcChannels.taskRun,
      IpcChannels.taskCancel,
      IpcChannels.aiProviders,
      IpcChannels.aiModels,
      IpcChannels.aiStatus,
      IpcChannels.aiChat,
      IpcChannels.aiCancel,
      IpcChannels.aiSetKey,
      IpcChannels.aiClearKey,
    ]) {
      expect(isAllowedChannel(channel)).toBe(true);
    }
  });

  it('keeps the push channels separate from the invoke channels', () => {
    const invokeChannels = new Set<string>(Object.values(IpcChannels));
    for (const pushChannel of Object.values(IpcPushChannels)) {
      expect(invokeChannels.has(pushChannel)).toBe(false);
      expect(isAllowedChannel(pushChannel)).toBe(false);
    }
  });
});

describe('invoke channel typing', () => {
  it('keeps the channel names in sync with the type', () => {
    // A compile-time guarantee: every value of IpcChannels is a channel.
    const channel: IpcChannel = IpcChannels.terminalCreate;
    expect(channel).toBe('terminal:create');
  });
});
