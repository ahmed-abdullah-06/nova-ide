import { describe, expect, it } from 'vitest';
import {
  getAllowedChannels,
  isAllowedChannel,
} from '../../apps/desktop/src/main/security/channels';
import { IpcChannels } from '../../apps/desktop/src/shared/ipc-types';

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
});
