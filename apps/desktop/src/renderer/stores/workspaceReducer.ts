/**
 * Pure workspace/explorer state machine (spec §7, §9, §24).
 *
 * Kept free of React and of any I/O so it can be unit tested directly, the
 * same way as `tabsReducer`. All filesystem work happens in the main
 * process; this reducer only records what the UI knows about it.
 */
import type {
  FileEntry,
  RecentWorkspace,
  Workspace,
} from '../../shared/ipc-types';

export type NotificationKind = 'info' | 'warning' | 'error';

export interface Notification {
  id: number;
  kind: NotificationKind;
  message: string;
}

/** Contents of one directory that has been read at least once. */
export interface DirectoryState {
  entries: FileEntry[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export type WorkspaceStatus = 'idle' | 'opening' | 'ready';

/** An in-tree inline input is active (spec §7.1 create/rename UX). */
export interface PendingInput {
  kind: 'create-file' | 'create-folder' | 'rename';
  /** Directory that receives the new entry, or parent of the renamed item. */
  parentPath: string;
  /** Path being renamed (null for create). */
  targetPath: string | null;
}

export interface WorkspaceState {
  workspace: Workspace | null;
  status: WorkspaceStatus;
  /** Canonical directory path → its (single-level) contents. */
  directories: Record<string, DirectoryState>;
  /** Canonical directory paths the user expanded (persisted in memory). */
  expandedPaths: string[];
  selectedPath: string | null;
  recent: RecentWorkspace[];
  notifications: Notification[];
  nextNotificationId: number;
  /** Active inline create/rename input, if any. */
  pendingInput: PendingInput | null;
}

export const initialWorkspaceState: WorkspaceState = {
  workspace: null,
  status: 'idle',
  directories: {},
  expandedPaths: [],
  selectedPath: null,
  recent: [],
  notifications: [],
  nextNotificationId: 1,
  pendingInput: null,
};

/** Only the newest notifications stay on screen. */
const MAX_VISIBLE_NOTIFICATIONS = 4;

/**
 * True when `candidate` is the workspace root or lives inside it.
 * Renderer-side staleness guard (NOT a security boundary — the main
 * process performs the real canonical containment check): a directory
 * read started before a workspace switch must not pollute the new
 * workspace's state when it resolves late.
 */
function belongsToRoot(root: string | null, candidate: string): boolean {
  if (root === null) {
    return false;
  }
  if (candidate === root) {
    return true;
  }
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.endsWith(separator) ? root : root + separator;
  return (
    candidate.startsWith(base) ||
    candidate.toLowerCase().startsWith(base.toLowerCase())
  );
}

export type WorkspaceAction =
  | { type: 'open-start' }
  | { type: 'open-cancelled' }
  | { type: 'open-failed'; message: string }
  | { type: 'open-succeeded'; workspace: Workspace }
  | { type: 'close' }
  | { type: 'recent-loaded'; recent: RecentWorkspace[] }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string }
  | { type: 'select'; path: string | null }
  | { type: 'load-start'; path: string }
  | { type: 'load-success'; path: string; entries: FileEntry[]; truncated: boolean }
  | { type: 'load-failure'; path: string; message: string }
  /** Drops one directory's cached contents so the effect re-reads it. */
  | { type: 'reload'; path: string }
  /** Drops every cached directory (contents are re-read lazily). */
  | { type: 'refresh' }
  | { type: 'notify'; kind: NotificationKind; message: string }
  | { type: 'dismiss-notification'; id: number }
  /** Opens the inline create/rename input (only one at a time). */
  | { type: 'start-input'; input: PendingInput }
  /** Cancels the inline input without touching the filesystem. */
  | { type: 'cancel-input' }
  /** A directory/file was renamed: re-key cached state to the new path. */
  | { type: 'path-renamed'; path: string; newPath: string; isDirectory: boolean }
  /** A directory/file was deleted: drop its cached state. */
  | { type: 'path-removed'; path: string; isDirectory: boolean };

function notify(
  state: WorkspaceState,
  kind: NotificationKind,
  message: string,
): WorkspaceState {
  const notifications = [
    ...state.notifications,
    { id: state.nextNotificationId, kind, message },
  ].slice(-MAX_VISIBLE_NOTIFICATIONS);
  return {
    ...state,
    notifications,
    nextNotificationId: state.nextNotificationId + 1,
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'open-start':
      return { ...state, status: 'opening' };

    case 'open-cancelled':
      return { ...state, status: state.workspace ? 'ready' : 'idle' };

    case 'open-failed':
      return notify(
        { ...state, status: state.workspace ? 'ready' : 'idle' },
        'error',
        action.message,
      );

    case 'open-succeeded': {
      const sameRoot = state.workspace?.rootPath === action.workspace.rootPath;
      return {
        ...state,
        workspace: action.workspace,
        status: 'ready',
        // Always re-read contents (the folder may have changed while the
        // app was closed), but remember the expansion of the same root.
        directories: {},
        expandedPaths: sameRoot
          ? state.expandedPaths
          : [action.workspace.rootPath],
        selectedPath: sameRoot ? state.selectedPath : null,
      };
    }

    case 'close':
      return initialWorkspaceState;

    case 'recent-loaded':
      return { ...state, recent: action.recent };

    case 'expand':
      if (state.expandedPaths.includes(action.path)) {
        return state;
      }
      return { ...state, expandedPaths: [...state.expandedPaths, action.path] };

    case 'collapse':
      if (!state.expandedPaths.includes(action.path)) {
        return state;
      }
      return {
        ...state,
        expandedPaths: state.expandedPaths.filter((p) => p !== action.path),
      };

    case 'select':
      return { ...state, selectedPath: action.path };

    case 'load-start': {
      // Ignore reads that belong to a previous workspace (stale in-flight
      // request resolving after a switch/close).
      if (!belongsToRoot(state.workspace?.rootPath ?? null, action.path)) {
        return state;
      }
      const existing = state.directories[action.path];
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.path]: {
            entries: existing?.entries ?? [],
            truncated: existing?.truncated ?? false,
            loading: true,
            error: null,
          },
        },
      };
    }

    case 'load-success': {
      if (!belongsToRoot(state.workspace?.rootPath ?? null, action.path)) {
        return state;
      }
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.path]: {
            entries: action.entries,
            truncated: action.truncated,
            loading: false,
            error: null,
          },
        },
      };
    }

    case 'load-failure': {
      if (!belongsToRoot(state.workspace?.rootPath ?? null, action.path)) {
        return state;
      }
      const existing = state.directories[action.path];
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.path]: {
            entries: existing?.entries ?? [],
            truncated: existing?.truncated ?? false,
            loading: false,
            error: action.message,
          },
        },
      };
    }

    case 'reload': {
      if (!(action.path in state.directories)) {
        return state;
      }
      const directories = { ...state.directories };
      delete directories[action.path];
      return { ...state, directories };
    }

    case 'refresh':
      return { ...state, directories: {} };

    case 'notify':
      return notify(state, action.kind, action.message);

    case 'dismiss-notification':
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.id),
      };

    case 'start-input':
      return { ...state, pendingInput: action.input };

    case 'cancel-input':
      return state.pendingInput === null
        ? state
        : { ...state, pendingInput: null };

    case 'path-renamed': {
      const remap = (p: string): string => {
        if (pathsEqual(p, action.path)) {
          return action.newPath;
        }
        if (action.isDirectory && isInside(p, action.path)) {
          return action.newPath + p.slice(action.path.length);
        }
        return p;
      };
      const directories: Record<string, DirectoryState> = {};
      for (const [key, value] of Object.entries(state.directories)) {
        // Contents of the renamed subtree are stale (child paths changed) —
        // drop them; visible branches re-read lazily through the effect.
        if (
          pathsEqual(key, action.path) ||
          (action.isDirectory && isInside(key, action.path))
        ) {
          continue;
        }
        directories[key] = value;
      }
      return {
        ...state,
        directories,
        expandedPaths: [...new Set(state.expandedPaths.map(remap))],
        selectedPath:
          state.selectedPath === null ? null : remap(state.selectedPath),
        pendingInput: null,
      };
    }

    case 'path-removed': {
      const gone = (p: string): boolean =>
        pathsEqual(p, action.path) ||
        (action.isDirectory && isInside(p, action.path));
      const directories: Record<string, DirectoryState> = {};
      let changed = false;
      for (const [key, value] of Object.entries(state.directories)) {
        if (gone(key)) {
          changed = true;
        } else {
          directories[key] = value;
        }
      }
      const expandedPaths = state.expandedPaths.filter((p) => {
        if (gone(p)) {
          changed = true;
          return false;
        }
        return true;
      });
      const selectedGone =
        state.selectedPath !== null && gone(state.selectedPath);
      if (selectedGone) {
        changed = true;
      }
      if (state.pendingInput !== null) {
        changed = true;
      }
      if (!changed) {
        return state;
      }
      return {
        ...state,
        directories,
        expandedPaths,
        selectedPath: selectedGone ? null : state.selectedPath,
        pendingInput: null,
      };
    }
  }
}

/** Case-insensitive absolute-path equality (win32 drives are case-insensitive). */
function pathsEqual(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** True when `child` lives strictly below `parent`. */
function isInside(child: string, parent: string): boolean {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const base = parent.endsWith(separator) ? parent : parent + separator;
  return (
    child.startsWith(base) || child.toLowerCase().startsWith(base.toLowerCase())
  );
}
