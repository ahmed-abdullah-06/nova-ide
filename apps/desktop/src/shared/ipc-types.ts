import type {
  AiResult,
  AIStreamEvent,
  ChatMessage,
  ContextPreview,
  ProviderDescriptor,
  ProviderModel,
  ProviderStatus,
  StoredConversation,
} from './ai-types';

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

/** Registry of all allowed IPC channels (renderer may only use these). */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appOpenExternal: 'app:open-external',
  workspaceOpen: 'workspace:open',
  workspaceClose: 'workspace:close',
  workspaceRecent: 'workspace:recent',
  workspaceActive: 'workspace:active',
  fsReadDir: 'fs:read-dir',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsSaveAs: 'fs:save-as',
  fsCreateFile: 'fs:create-file',
  fsCreateFolder: 'fs:create-folder',
  fsRename: 'fs:rename',
  fsDelete: 'fs:delete',
  fsSyncOpenFiles: 'fs:sync-open-files',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  searchQuery: 'search:query',
  searchCancel: 'search:cancel',
  gitStatus: 'git:status',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitDiff: 'git:diff',
  gitBranches: 'git:branches',
  gitSwitchBranch: 'git:switch-branch',
  taskList: 'task:list',
  taskRun: 'task:run',
  taskCancel: 'task:cancel',
  aiProviders: 'ai:providers',
  aiModels: 'ai:models',
  aiStatus: 'ai:status',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  aiSetKey: 'ai:set-key',
  aiClearKey: 'ai:clear-key',
  aiConversations: 'ai:conversations',
  aiConversationSave: 'ai:conversation-save',
  aiConversationDelete: 'ai:conversation-delete',
  aiProviderUpdate: 'ai:provider-update',
  aiProviderRemove: 'ai:provider-remove',
  aiPickFiles: 'ai:pick-files',
  aiContextPreview: 'ai:context-preview',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/**
 * Channels the main process pushes events on (main → renderer).
 * Kept separate from `IpcChannels` because they have no invoke/response
 * contract — they are subscriptions exposed through the preload bridge.
 */
export const IpcPushChannels = {
  fsExternalChange: 'fs:external-change',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  searchResults: 'search:results',
  taskOutput: 'task:output',
  taskStatus: 'task:status',
  aiStream: 'ai:stream',
} as const;

export type IpcPushChannel =
  (typeof IpcPushChannels)[keyof typeof IpcPushChannels];

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

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export type WorkspaceStatus = 'open' | 'missing';

/** An opened project folder (spec §7.1, §18.1). */
export interface Workspace {
  id: string;
  /** Display name (basename of the folder the user chose). */
  name: string;
  /** Canonical (symlink-resolved) root directory of the workspace. */
  rootPath: string;
  lastOpenedAt: number;
  /** 'missing' when the root directory disappears while open. */
  status: WorkspaceStatus;
}

/** Entry persisted for the Recent Workspaces list (paths only, no contents). */
export interface RecentWorkspace {
  id: string;
  name: string;
  rootPath: string;
  lastOpenedAt: number;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export type FileKind = 'file' | 'directory';

/** One directory entry as returned by `fs:read-dir`. */
export interface FileEntry {
  name: string;
  /** Absolute path inside the workspace. */
  path: string;
  kind: FileKind;
}

/** Result of listing one directory (single level — never recursive). */
export interface DirListing {
  entries: FileEntry[];
  /** True when the directory had more entries than the main-process cap. */
  truncated: boolean;
}

/** A text file read from disk. */
export interface FileContent {
  path: string;
  content: string;
  /** Modification time (ms since epoch) captured BEFORE the read, so a save
   *  can detect external modifications conservatively. */
  mtimeMs: number;
  size: number;
}

/** Receipt returned after a successful write. */
export interface SaveReceipt {
  path: string;
  mtimeMs: number;
}

/**
 * Structured error codes for filesystem/workspace operations.
 * Handlers return these instead of throwing so the renderer can show
 * precise, user-friendly messages (spec §10, §19.3).
 */
export type FsErrorCode =
  | 'NO_WORKSPACE'
  | 'WORKSPACE_MISSING'
  | 'OUTSIDE_WORKSPACE'
  | 'INVALID_PATH'
  | 'INVALID_NAME'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'NOT_A_DIRECTORY'
  | 'IS_DIRECTORY'
  | 'FILE_TOO_LARGE'
  | 'BINARY_FILE'
  | 'CONFLICT'
  | 'CANCELLED'
  | 'ROOT_PROTECTED'
  | 'UNKNOWN';

/** Discriminated result shared by every filesystem/workspace operation. */
export type FsResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: FsErrorCode; message: string };

/** Payload of the `fs:external-change` push event. */
export interface ExternalChange {
  path: string;
  kind: 'changed' | 'missing';
  /** Disk modification time after the change (`null` when missing). Lets the
   *  renderer ignore notifications caused by its own saves. */
  mtimeMs: number | null;
}

// ---------------------------------------------------------------------------
// Search (spec §7, §21)
// ---------------------------------------------------------------------------

/**
 * One search result.
 *
 * A file-name match has `line === 0`; a content match points at the line
 * and column of the occurrence.
 */
export interface SearchMatch {
  /** Absolute path inside the workspace. */
  path: string;
  /** Path relative to the workspace root (for display). */
  relativePath: string;
  /** File name including extension. */
  name: string;
  /** 1-based line number, or 0 for a file-name match. */
  line: number;
  /** 1-based column of the match, or 0 for a file-name match. */
  column: number;
  /** The matched text (the file name, or the matching line). */
  preview: string;
}

/** A batch of search results delivered incrementally to the renderer. */
export interface SearchResults {
  /** Correlates the batch with the request that produced it. */
  requestId: string;
  matches: SearchMatch[];
  /** True when the search finished (the final batch). */
  done: boolean;
  /** True when the result cap was reached (results were truncated). */
  truncated: boolean;
}

/** How a search should be performed. */
export type SearchMode = 'files' | 'content';

// ---------------------------------------------------------------------------
// Git (spec §16)
// ---------------------------------------------------------------------------

/** One changed file of the repository. */
export interface GitFileChange {
  /** Absolute path inside the workspace. */
  path: string;
  /** Path relative to the repository root (for display). */
  relativePath: string;
  /** True when the change is staged (in the index). */
  staged: boolean;
  /** The porcelain status code of the change (M, A, D, R, ?, ...). */
  status: string;
}

/** One branch of the repository. */
export interface GitBranch {
  /** The name of the branch (for example "main"). */
  name: string;
  /** True when the branch is the checked out one. */
  current: boolean;
}

/** The state of the repository of the active workspace. */
export interface GitStatus {
  /** False when the workspace is not inside a git repository. */
  isRepository: boolean;
  /** The current branch, or null (detached HEAD / no repository). */
  branch: string | null;
  /** The upstream branch, or null when there is none. */
  upstream: string | null;
  /** Number of commits that are ahead of the upstream. */
  ahead: number;
  /** Number of commits that are behind the upstream. */
  behind: number;
  /** The staged changes. */
  staged: GitFileChange[];
  /** The changes in the working tree that are not staged. */
  unstaged: GitFileChange[];
  /** The files that git does not track yet. */
  untracked: GitFileChange[];
}

// ---------------------------------------------------------------------------
// Tasks (spec §6.1, §21)
// ---------------------------------------------------------------------------

/** One script of the workspace `package.json`. */
export interface TaskDefinition {
  /** The name of the script (the key in `package.json`). */
  name: string;
  /** The command of the script (for display only). */
  command: string;
}

/** The lifecycle state of a task. */
export type TaskStatus = 'running' | 'success' | 'failed' | 'cancelled';

/** A chunk of output of a running task. */
export interface TaskOutput {
  /** The id of the task the output belongs to. */
  taskId: string;
  /** The output text. */
  chunk: string;
}

/** A lifecycle change of a task. */
export interface TaskStatusEvent {
  /** The id of the task. */
  taskId: string;
  /** The new state of the task. */
  status: TaskStatus;
  /** The exit code, or null when the task was cancelled. */
  exitCode: number | null;
}

// ---------------------------------------------------------------------------
// Terminal (spec §6.1, §17)
// ---------------------------------------------------------------------------

/** Description of a live terminal session. */
export interface TerminalSession {
  /** Opaque session id generated by the main process. */
  id: string;
  /** Human-readable name of the shell that was started. */
  shell: string;
  /** Working directory of the session (always inside the workspace). */
  cwd: string;
  /** Terminal size in character cells. */
  cols: number;
  rows: number;
}

/** Payload of the `terminal:data` push event (untrusted program output). */
export interface TerminalData {
  sessionId: string;
  data: string;
}

/** Payload of the `terminal:exit` push event. */
export interface TerminalExit {
  sessionId: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Invoke map (compile-time contract per channel)
// ---------------------------------------------------------------------------

/**
 * Per-channel request/response typing.
 * Every channel in `IpcChannels` must have an entry here (enforced below).
 */
export interface IpcInvokeMap {
  'app:get-info': { args: []; result: AppInfo };
  /**
   * Opens a link in the browser of the user.
   *
   * Only http and https are accepted; the address is never taken from the
   * model output without that check.
   */
  'app:open-external': { args: [url: string]; result: FsResult<void> };
  /** No argument → native folder dialog; with a path → open that folder
   *  (used by Recent Workspaces). `value: null` means the user cancelled. */
  'workspace:open': { args: [path?: string]; result: FsResult<Workspace | null> };
  'workspace:close': { args: []; result: void };
  'workspace:recent': { args: []; result: RecentWorkspace[] };
  /** The workspace that is currently open in the main process. */
  'workspace:active': { args: []; result: FsResult<Workspace | null> };
  'fs:read-dir': { args: [path: string]; result: FsResult<DirListing> };
  'fs:read-file': { args: [path: string]; result: FsResult<FileContent> };
  /** `expectedMtimeMs: null` forces the write (explicit user overwrite). */
  'fs:write-file': {
    args: [path: string, content: string, expectedMtimeMs: number | null];
    result: FsResult<SaveReceipt>;
  };
  /** Native save dialog; resolves to `{ok:true, value:null}` when cancelled. */
  'fs:save-as': {
    args: [suggestedPath: string | null, content: string];
    result: FsResult<SaveReceipt | null>;
  };
  'fs:create-file': { args: [path: string]; result: FsResult<FileEntry> };
  'fs:create-folder': { args: [path: string]; result: FsResult<FileEntry> };
  /** Renames within the same parent directory (`newName` is a bare name). */
  'fs:rename': { args: [path: string, newName: string]; result: FsResult<FileEntry> };
  'fs:delete': { args: [path: string]; result: FsResult<{ path: string }> };
  /** Informs the main process which files are open so it can watch them for
   *  external modifications (spec §7.1). */
  'fs:sync-open-files': {
    args: [paths: string[]];
    result: FsResult<{ watching: number }>;
  };
  /** Starts a terminal session in the workspace root. */
  'terminal:create': {
    args: [cwd?: string];
    result: FsResult<TerminalSession>;
  };
  /** Writes user input to a terminal session. */
  'terminal:write': {
    args: [sessionId: string, data: string];
    result: FsResult<void>;
  };
  /** Resizes a terminal session (character cells). */
  'terminal:resize': {
    args: [sessionId: string, cols: number, rows: number];
    result: FsResult<void>;
  };
  /** Terminates a terminal session and its process tree. */
  'terminal:kill': {
    args: [sessionId: string];
    result: FsResult<void>;
  };
  /** Starts a workspace-scoped search. Results are streamed back through the
   *  `search:results` push channel. */
  'search:query': {
    args: [requestId: string, mode: SearchMode, pattern: string];
    result: FsResult<{ requestId: string }>;
  };
  /** Cancels a running search by request id. */
  'search:cancel': {
    args: [requestId: string];
    result: FsResult<void>;
  };
  /** Reads the repository status of the workspace. */
  'git:status': { args: []; result: FsResult<GitStatus> };
  /** Stages a path. */
  'git:stage': { args: [path: string]; result: FsResult<GitStatus> };
  /** Unstages a path. */
  'git:unstage': { args: [path: string]; result: FsResult<GitStatus> };
  /** Discards the local changes of a path. */
  'git:discard': { args: [path: string]; result: FsResult<GitStatus> };
  /** Creates a commit from the staged changes. */
  'git:commit': { args: [message: string]; result: FsResult<GitStatus> };
  /** Reads the textual diff of a path. */
  'git:diff': {
    args: [path: string, staged: boolean];
    result: FsResult<{ diff: string }>;
  };
  /** Lists the local branches of the repository. */
  'git:branches': { args: []; result: FsResult<GitBranch[]> };
  /** Checks out another local branch. */
  'git:switch-branch': { args: [name: string]; result: FsResult<GitStatus> };
  /** Lists the scripts of the workspace package.json. */
  'task:list': { args: []; result: FsResult<TaskDefinition[]> };
  /** Starts the script with the given name. */
  'task:run': { args: [name: string]; result: FsResult<{ taskId: string }> };
  /** Stops a running task and kills its process tree. */
  'task:cancel': { args: [taskId: string]; result: FsResult<void> };
  /** The providers the user can choose from (never a key). */
  'ai:providers': { args: []; result: AiResult<ProviderDescriptor[]> };
  /** The models a provider offers. */
  'ai:models': {
    args: [providerId: string];
    result: AiResult<ProviderModel[]>;
  };
  /** Checks whether a provider can be reached. */
  'ai:status': {
    args: [providerId: string];
    result: AiResult<ProviderStatus>;
  };
  /**
   * Starts a chat request. The events arrive through the `ai:stream`
   * push channel and are correlated through the request id.
   */
  'ai:chat': {
    args: [
      requestId: string,
      providerId: string,
      model: string,
      messages: ChatMessage[],
      attachments: { path: string; kind: 'selection' | 'file' }[],
      approveCloudContext: boolean,
    ];
    result: AiResult<{ requestId: string }>;
  };
  /** Cancels a running chat request. */
  'ai:cancel': { args: [requestId: string]; result: AiResult<void> };
  /**
   * Stores the API key of a provider.
   *
   * The key is encrypted by the main process and never returned.
   */
  'ai:set-key': {
    args: [providerId: string, key: string];
    result: AiResult<{ configured: boolean }>;
  };
  /** Removes the API key of a provider. */
  'ai:clear-key': {
    args: [providerId: string];
    result: AiResult<{ configured: boolean }>;
  };
  /** The conversations of the chat. */
  'ai:conversations': { args: []; result: StoredConversation[] };
  /** Stores a conversation. */
  'ai:conversation-save': {
    args: [conversation: StoredConversation];
    result: StoredConversation;
  };
  /** Removes a conversation. */
  'ai:conversation-delete': { args: [id: string]; result: void };
  /**
   * Changes the settings of a provider.
   *
   * The address of a cloud provider is only used after the user
   * confirmed it explicitly.
   */
  'ai:provider-update': {
    args: [
      providerId: string,
      settings: {
        baseUrl?: string;
        enabled?: boolean;
        remoteConfirmed?: boolean;
      },
    ];
    result: AiResult<ProviderDescriptor>;
  };
  /** Removes the configuration of a provider. */
  'ai:provider-remove': {
    args: [providerId: string];
    result: AiResult<ProviderDescriptor>;
  };
  /**
   * Lets the user pick the files that are attached as context.
   *
   * The dialog is restricted to the workspace, so a file outside of it
   * can never be attached.
   */
  'ai:pick-files': { args: []; result: FsResult<string[]> };
  /**
   * Describes the context of a request before it is sent.
   */
  'ai:context-preview': {
    args: [attachments: { path: string; kind: 'selection' | 'file' }[]];
    result: AiResult<ContextPreview[]>;
  };
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

// ---------------------------------------------------------------------------
// Public preload API
// ---------------------------------------------------------------------------

export interface NovaWorkspaceApi {
  /** Opens a folder (native dialog when `path` is omitted). */
  open(path?: string): Promise<FsResult<Workspace | null>>;
  close(): Promise<void>;
  recent(): Promise<RecentWorkspace[]>;
  /**
   * The workspace that is currently open in the main process.
   *
   * The renderer uses this to stay in sync when the workspace was changed
   * from the outside (for example by a second window).
   */
  active(): Promise<FsResult<Workspace | null>>;
  /** Subscribes to external modifications of open files; returns unsubscribe. */
  onExternalChange(
    listener: (change: ExternalChange) => void,
  ): () => void;
}

export interface NovaFsApi {
  readDirectory(path: string): Promise<FsResult<DirListing>>;
  readFile(path: string): Promise<FsResult<FileContent>>;
  writeFile(
    path: string,
    content: string,
    expectedMtimeMs: number | null,
  ): Promise<FsResult<SaveReceipt>>;
  saveAs(
    suggestedPath: string | null,
    content: string,
  ): Promise<FsResult<SaveReceipt | null>>;
  createFile(path: string): Promise<FsResult<FileEntry>>;
  createFolder(path: string): Promise<FsResult<FileEntry>>;
  rename(path: string, newName: string): Promise<FsResult<FileEntry>>;
  delete(path: string): Promise<FsResult<{ path: string }>>;
  syncOpenFiles(paths: string[]): Promise<FsResult<{ watching: number }>>;
}

/** Project / file search (spec §7, §21). */
export interface NovaSearchApi {
  /** Starts a search; results arrive through `onResults`. */
  query(
    requestId: string,
    mode: SearchMode,
    pattern: string,
  ): Promise<FsResult<{ requestId: string }>>;
  /** Cancels a running search. */
  cancel(requestId: string): Promise<FsResult<void>>;
  /** Subscribes to (incremental) search results. */
  onResults(listener: (results: SearchResults) => void): () => void;
}

/** Git integration (spec §16). */
export interface NovaGitApi {
  /** Reads the repository status. */
  status(): Promise<FsResult<GitStatus>>;
  /** Stages a path. */
  stage(path: string): Promise<FsResult<GitStatus>>;
  /** Unstages a path. */
  unstage(path: string): Promise<FsResult<GitStatus>>;
  /** Discards the local changes of a path. */
  discard(path: string): Promise<FsResult<GitStatus>>;
  /** Creates a commit from the staged changes. */
  commit(message: string): Promise<FsResult<GitStatus>>;
  /** Reads the textual diff of a path. */
  diff(path: string, staged: boolean): Promise<FsResult<{ diff: string }>>;
  /** Lists the local branches of the repository. */
  branches(): Promise<FsResult<GitBranch[]>>;
  /** Checks out another local branch. */
  switchBranch(name: string): Promise<FsResult<GitStatus>>;
}

/** Build / test task runner (spec §6.1, §21). */
export interface NovaTaskApi {
  /** Lists the scripts of the workspace. */
  list(): Promise<FsResult<TaskDefinition[]>>;
  /** Starts a script by name. */
  run(name: string): Promise<FsResult<{ taskId: string }>>;
  /** Stops a running task. */
  cancel(taskId: string): Promise<FsResult<void>>;
  /** Subscribes to the output of the tasks. */
  onOutput(listener: (output: TaskOutput) => void): () => void;
  /** Subscribes to the lifecycle changes of the tasks. */
  onStatus(listener: (status: TaskStatusEvent) => void): () => void;
}

/** AI providers and chat (spec §11). */
export interface NovaAiApi {
  /** The conversations of the chat. */
  conversations(): Promise<StoredConversation[]>;
  /** Stores a conversation. */
  saveConversation(
    conversation: StoredConversation,
  ): Promise<StoredConversation>;
  /** Removes a conversation. */
  deleteConversation(id: string): Promise<void>;
  /** Changes the settings of a provider. */
  updateProvider(
    providerId: string,
    settings: {
      baseUrl?: string;
      enabled?: boolean;
      remoteConfirmed?: boolean;
    },
  ): Promise<AiResult<ProviderDescriptor>>;
  /** Removes the configuration of a provider. */
  removeProvider(providerId: string): Promise<AiResult<ProviderDescriptor>>;
  /** Lets the user pick the files that are attached as context. */
  pickFiles(): Promise<FsResult<string[]>>;
  /** Describes the context of a request before it is sent. */
  previewContext(
    attachments: { path: string; kind: 'selection' | 'file' }[],
  ): Promise<AiResult<ContextPreview[]>>;
  /** The providers the user can choose from. */
  providers(): Promise<AiResult<ProviderDescriptor[]>>;
  /** The models a provider offers. */
  models(providerId: string): Promise<AiResult<ProviderModel[]>>;
  /** Checks whether a provider can be reached. */
  status(providerId: string): Promise<AiResult<ProviderStatus>>;
  /** Subscribes to the streaming answer of a request. */
  onStream(
    listener: (payload: { requestId: string; event: AIStreamEvent }) => void,
  ): () => void;
  /** Starts a chat request; the answer arrives through `onStream`. */
  chat(
    requestId: string,
    providerId: string,
    model: string,
    messages: ChatMessage[],
    attachments: { path: string; kind: 'selection' | 'file' }[],
    approveCloudContext: boolean,
  ): Promise<AiResult<{ requestId: string }>>;
  /** Cancels a running request. */
  cancel(requestId: string): Promise<AiResult<void>>;
  /** Stores the API key of a provider (the key is never returned). */
  setKey(providerId: string, key: string): Promise<AiResult<{ configured: boolean }>>;
  /** Removes the API key of a provider. */
  clearKey(providerId: string): Promise<AiResult<{ configured: boolean }>>;
}

/** Public API exposed on `window.nova` by the preload bridge. */
export interface NovaApi {
  getAppInfo(): Promise<AppInfo>;
  /** Opens a link in the browser of the user. */
  openExternal(url: string): Promise<FsResult<void>>;
  workspace: NovaWorkspaceApi;
  fs: NovaFsApi;
  terminal: NovaTerminalApi;
  search: NovaSearchApi;
  git: NovaGitApi;
  task: NovaTaskApi;
  ai: NovaAiApi;
}

/**
 * Integrated terminal (spec §6.1, §17).
 *
 * The renderer can only drive a session it created; it never receives a raw
 * shell handle, a command string, or any Node.js API.
 */
export interface NovaTerminalApi {
  /** Starts a session (defaults to the workspace root). */
  create(cwd?: string): Promise<FsResult<TerminalSession>>;
  /** Sends user input (keystrokes) to the session. */
  write(sessionId: string, data: string): Promise<FsResult<void>>;
  /** Resizes the session's pseudo-terminal. */
  resize(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<FsResult<void>>;
  /** Terminates the session and its process tree. */
  kill(sessionId: string): Promise<FsResult<void>>;
  /** Subscribes to terminal output; returns an unsubscribe function. */
  onData(listener: (data: TerminalData) => void): () => void;
  /** Subscribes to session exits; returns an unsubscribe function. */
  onExit(listener: (exit: TerminalExit) => void): () => void;
}

/** Build / test task runner (spec §21). */
