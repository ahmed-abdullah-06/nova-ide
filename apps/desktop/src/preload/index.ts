import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type AppInfo, type NovaApi } from '../shared/ipc-types';

/**
 * Secure preload bridge (spec §19.1).
 *
 * Exposes only the narrow, typed NOVA API to the renderer via contextBridge.
 * The renderer never gets access to ipcRenderer, Node.js, or any other
 * privileged Electron/OS API — only the functions declared in `NovaApi`.
 */
const novaApi: NovaApi = {
  getAppInfo: (): Promise<AppInfo> =>
    ipcRenderer.invoke(IpcChannels.appGetInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('nova', novaApi);
