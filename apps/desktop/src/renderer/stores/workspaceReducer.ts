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
  | { type: 'dismiss-notification'; id: number };

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
  }
}
