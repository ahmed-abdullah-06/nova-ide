import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannels,
  IpcPushChannels,
  type ExternalChange,
  type IpcInvokeMap,
  type NovaApi,
} from '../shared/ipc-types';

/** Typed `ipcRenderer.invoke` restricted to the shared channel contract. */
function invoke<C extends keyof IpcInvokeMap & string>(
  channel: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<
    IpcInvokeMap[C]['result']
  >;
}

/**
 * Secure preload bridge (spec §19.1).
 *
 * Exposes only the narrow, typed NOVA API to the renderer via contextBridge.
 * The renderer never gets access to ipcRenderer, Node.js, or any other
 * privileged Electron/OS API — only the functions declared in `NovaApi`.
 */
const novaApi: NovaApi = {
  getAppInfo: () => invoke(IpcChannels.appGetInfo),

  workspace: {
    open: (pathValue?: string) =>
      pathValue === undefined
        ? invoke(IpcChannels.workspaceOpen)
        : invoke(IpcChannels.workspaceOpen, pathValue),
    close: () => invoke(IpcChannels.workspaceClose),
    recent: () => invoke(IpcChannels.workspaceRecent),
    onExternalChange: (listener) => {
      const handler = (_event: IpcRendererEvent, change: ExternalChange): void =>
        listener(change);
      ipcRenderer.on(IpcPushChannels.fsExternalChange, handler);
      return () => {
        ipcRenderer.removeListener(IpcPushChannels.fsExternalChange, handler);
      };
    },
  },

  fs: {
    readDirectory: (pathValue) => invoke(IpcChannels.fsReadDir, pathValue),
    readFile: (pathValue) => invoke(IpcChannels.fsReadFile, pathValue),
    writeFile: (pathValue, content, expectedMtimeMs) =>
      invoke(IpcChannels.fsWriteFile, pathValue, content, expectedMtimeMs),
    saveAs: (suggestedPath, content) =>
      invoke(IpcChannels.fsSaveAs, suggestedPath, content),
    createFile: (pathValue) => invoke(IpcChannels.fsCreateFile, pathValue),
    createFolder: (pathValue) => invoke(IpcChannels.fsCreateFolder, pathValue),
    rename: (pathValue, newName) =>
      invoke(IpcChannels.fsRename, pathValue, newName),
    delete: (pathValue) => invoke(IpcChannels.fsDelete, pathValue),
    syncOpenFiles: (paths) => invoke(IpcChannels.fsSyncOpenFiles, paths),
  },
};

contextBridge.exposeInMainWorld('nova', novaApi);
