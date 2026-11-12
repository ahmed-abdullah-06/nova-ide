import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannels,
  IpcPushChannels,
  type ExternalChange,
  type IpcInvokeMap,
  type NovaApi,
  type TaskOutput,
  type TaskStatusEvent,
  type SearchResults,
  type TerminalData,
  type TerminalExit,
} from '../shared/ipc-types';
import type { AIStreamEvent } from '../shared/ai-types';

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
 * Subscribes to a push channel and returns an unsubscribe function.
 *
 * The payload is passed through unchanged; the main process is the only
 * producer, so no additional validation is required here.
 */
function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
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
  openExternal: (url) => invoke(IpcChannels.appOpenExternal, url),

  workspace: {
    open: (pathValue?: string) =>
      pathValue === undefined
        ? invoke(IpcChannels.workspaceOpen)
        : invoke(IpcChannels.workspaceOpen, pathValue),
    close: () => invoke(IpcChannels.workspaceClose),
    recent: () => invoke(IpcChannels.workspaceRecent),
    active: () => invoke(IpcChannels.workspaceActive),
    onExternalChange: (listener) =>
      subscribe<ExternalChange>(
        IpcPushChannels.fsExternalChange,
        listener,
      ),
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

  search: {
    query: (requestId, mode, pattern) =>
      invoke(IpcChannels.searchQuery, requestId, mode, pattern),
    cancel: (requestId) => invoke(IpcChannels.searchCancel, requestId),
    onResults: (listener) =>
      subscribe<SearchResults>(IpcPushChannels.searchResults, listener),
  },

  git: {
    status: () => invoke(IpcChannels.gitStatus),
    stage: (path) => invoke(IpcChannels.gitStage, path),
    unstage: (path) => invoke(IpcChannels.gitUnstage, path),
    discard: (path) => invoke(IpcChannels.gitDiscard, path),
    commit: (message) => invoke(IpcChannels.gitCommit, message),
    diff: (path, staged) => invoke(IpcChannels.gitDiff, path, staged),
    branches: () => invoke(IpcChannels.gitBranches),
    switchBranch: (name) => invoke(IpcChannels.gitSwitchBranch, name),
  },

  task: {
    list: () => invoke(IpcChannels.taskList),
    run: (name) => invoke(IpcChannels.taskRun, name),
    cancel: (taskId) => invoke(IpcChannels.taskCancel, taskId),
    onOutput: (listener) =>
      subscribe<TaskOutput>(IpcPushChannels.taskOutput, listener),
    onStatus: (listener) =>
      subscribe<TaskStatusEvent>(IpcPushChannels.taskStatus, listener),
  },

  ai: {
    providers: () => invoke(IpcChannels.aiProviders),
    models: (providerId) => invoke(IpcChannels.aiModels, providerId),
    status: (providerId) => invoke(IpcChannels.aiStatus, providerId),
    onStream: (listener) =>
      subscribe<{ requestId: string; event: AIStreamEvent }>(
        IpcPushChannels.aiStream,
        listener,
      ),
    chat: (requestId, providerId, model, messages, attachments, approved) =>
      invoke(
        IpcChannels.aiChat,
        requestId,
        providerId,
        model,
        messages,
        attachments,
        approved,
      ),
    cancel: (requestId) => invoke(IpcChannels.aiCancel, requestId),
    setKey: (providerId, key) => invoke(IpcChannels.aiSetKey, providerId, key),
    clearKey: (providerId) => invoke(IpcChannels.aiClearKey, providerId),
    conversations: () => invoke(IpcChannels.aiConversations),
    saveConversation: (conversation) =>
      invoke(IpcChannels.aiConversationSave, conversation),
    deleteConversation: (id) => invoke(IpcChannels.aiConversationDelete, id),
    updateProvider: (providerId, settings) =>
      invoke(IpcChannels.aiProviderUpdate, providerId, settings),
    removeProvider: (providerId) =>
      invoke(IpcChannels.aiProviderRemove, providerId),
  },

  terminal: {
    create: (cwd) => invoke(IpcChannels.terminalCreate, cwd),
    write: (sessionId, data) =>
      invoke(IpcChannels.terminalWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      invoke(IpcChannels.terminalResize, sessionId, cols, rows),
    kill: (sessionId) => invoke(IpcChannels.terminalKill, sessionId),
    onData: (listener) => subscribe<TerminalData>(IpcPushChannels.terminalData, listener),
    onExit: (listener) => subscribe<TerminalExit>(IpcPushChannels.terminalExit, listener),
  },

};

contextBridge.exposeInMainWorld('nova', novaApi);
