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
  workspaceOpen: 'workspace:open',
  workspaceClose: 'workspace:close',
  workspaceRecent: 'workspace:recent',
  fsReadDir: 'fs:read-dir',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsSaveAs: 'fs:save-as',
  fsCreateFile: 'fs:create-file',
  fsCreateFolder: 'fs:create-folder',
  fsRename: 'fs:rename',
  fsDelete: 'fs:delete',
  fsSyncOpenFiles: 'fs:sync-open-files',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/**
 * Channels the main process pushes events on (main → renderer).
 * Kept separate from `IpcChannels` because they have no invoke/response
 * contract — they are subscriptions exposed through the preload bridge.
 */
export const IpcPushChannels = {
  fsExternalChange: 'fs:external-change',
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
// Invoke map (compile-time contract per channel)
// ---------------------------------------------------------------------------

/**
 * Per-channel request/response typing.
 * Every channel in `IpcChannels` must have an entry here (enforced below).
 */
export interface IpcInvokeMap {
  'app:get-info': { args: []; result: AppInfo };
  /** No argument → native folder dialog; with a path → open that folder
   *  (used by Recent Workspaces). `value: null` means the user cancelled. */
  'workspace:open': { args: [path?: string]; result: FsResult<Workspace | null> };
  'workspace:close': { args: []; result: void };
  'workspace:recent': { args: []; result: RecentWorkspace[] };
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

/** Public API exposed on `window.nova` by the preload bridge. */
export interface NovaApi {
  getAppInfo(): Promise<AppInfo>;
  workspace: NovaWorkspaceApi;
  fs: NovaFsApi;
}
