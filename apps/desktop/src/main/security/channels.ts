import { IpcChannels, type IpcChannel } from '../../shared/ipc-types';

/** Every IPC channel the main process is willing to serve (spec §19.2). */
const ALLOWED_CHANNELS: ReadonlySet<string> = new Set<string>(
  Object.values(IpcChannels),
);

export function isAllowedChannel(channel: string): channel is IpcChannel {
  return ALLOWED_CHANNELS.has(channel);
}

export function getAllowedChannels(): readonly IpcChannel[] {
  return Object.values(IpcChannels);
}
