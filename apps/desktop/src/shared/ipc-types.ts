/**
 * Typed IPC contract between the renderer and the Electron main process.
 *
 * This file is shared by:
 *  - the main process (handlers),
 *  - the preload bridge (exposed API),
 *  - the renderer (consumers).
 *
 * It must never import Node.js or Electron runtime APIs so it stays usable
 * in the sandboxed renderer type-check (spec §4, §19).
 */

/** Registry of all allowed IPC channel names (renderer may only use these). */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** Basic application/runtime information exposed to the renderer. */
export interface AppInfo {
  appName: string;
  appVersion: string;
  isPackaged: boolean;
  platform: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
}

/**
 * Per-channel request/response typing.
 * Every channel in `IpcChannels` must have an entry here (enforced below).
 */
export interface IpcInvokeMap {
  'app:get-info': { args: []; result: AppInfo };
}

/**
 * Compile-time guard: the channel registry and the invoke map must stay in
 * sync. If a channel is added to one but not the other, this type fails to
 * resolve and the build breaks.
 */
type Assert<T extends true> = T;
export type ChannelsCovered = Assert<
  [IpcChannel] extends [keyof IpcInvokeMap]
    ? [keyof IpcInvokeMap] extends [IpcChannel]
      ? true
      : false
    : false
>;

/** Public API exposed on `window.nova` by the preload bridge. */
export interface NovaApi {
  getAppInfo(): Promise<AppInfo>;
}
