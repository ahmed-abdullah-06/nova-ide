/**
 * Pure editor-tabs state machine (kept free of React/UI so it can be unit
 * tested directly — spec §24).
 */

export interface EditorTab {
  id: string;
  name: string;
  /** Monaco language id (e.g. "typescript", "plaintext"). */
  language: string;
  /** In-memory buffer content (loaded from disk for file-backed tabs). */
  content: string;
  isDirty: boolean;
  /** Absolute file path for file-backed tabs; null for untitled buffers. */
  filePath: string | null;
  /** Disk modification time from the last read/save; null for untitled. */
  mtimeMs: number | null;
}

export interface TabsState {
  tabs: EditorTab[];
  activeTabId: string | null;
  /** Counter used to name new untitled buffers (Untitled-1, Untitled-2, ...). */
  untitledCounter: number;
}

export type TabsAction =
  | {
      type: 'open';
      id: string;
      name: string;
      language: string;
      content: string;
      filePath?: string | null;
      mtimeMs?: number | null;
    }
  | { type: 'new-untitled'; language: string }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'update-content'; id: string; content: string }
  | { type: 'set-language'; id: string; language: string }
  /** A save succeeded: buffer matches disk again (spec §7.1). */
  | { type: 'mark-saved'; id: string; mtimeMs: number }
  /** Save-As bound an untitled buffer (or re-pointed a tab) to a path. */
  | {
      type: 'set-file-path';
      id: string;
      filePath: string;
      name: string;
      language?: string;
      mtimeMs: number;
    }
  /** The file/folder behind a tab was renamed on disk. */
  | { type: 'rename-file'; path: string; newPath: string; isDirectory: boolean }
  /** The file behind a tab (or its ancestor folder) was deleted. */
  | { type: 'close-by-path'; path: string; isDirectory: boolean }
  /** External change on a clean buffer: adopt the on-disk content.
   *  `force` is only set after the user explicitly confirmed discarding
   *  their unsaved edits. */
  | {
      type: 'reload-content';
      id: string;
      content: string;
      mtimeMs: number;
      force?: boolean;
    };

export const initialTabsState: TabsState = {
  tabs: [],
  activeTabId: null,
  untitledCounter: 0,
};

function activateNeighbour(state: TabsState, closedIndex: number): string | null {
  const neighbour = state.tabs[closedIndex + 1] ?? state.tabs[closedIndex - 1];
  return neighbour ? neighbour.id : null;
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const existing = state.tabs.find((tab) => tab.id === action.id);
      if (existing) {
        // Re-opening an existing tab just focuses it (idempotent).
        return { ...state, activeTabId: action.id };
      }
      const newTab: EditorTab = {
        id: action.id,
        name: action.name,
        language: action.language,
        content: action.content,
        isDirty: false,
        filePath: action.filePath ?? null,
        mtimeMs: action.mtimeMs ?? null,
      };
      return {
        ...state,
        tabs: [...state.tabs, newTab],
        activeTabId: action.id,
      };
    }

    case 'new-untitled': {
      const number = state.untitledCounter + 1;
      const newTab: EditorTab = {
        id: `untitled-${number}`,
        name: `Untitled-${number}`,
        language: action.language,
        content: '',
        isDirty: false,
        filePath: null,
        mtimeMs: null,
      };
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        untitledCounter: number,
      };
    }

    case 'close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) {
        return state;
      }
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeTabId =
        state.activeTabId === action.id
          ? activateNeighbour(state, index)
          : state.activeTabId;
      return { ...state, tabs, activeTabId };
    }

    case 'activate': {
      if (!state.tabs.some((tab) => tab.id === action.id)) {
        return state;
      }
      return { ...state, activeTabId: action.id };
    }

    case 'update-content': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) {
        return state;
      }
      const current = state.tabs[index] as EditorTab;
      // Ignore no-op change events (e.g. model re-attach with same text):
      // a tab only becomes dirty when its buffer really differs.
      if (current.content === action.content) {
        return state;
      }
      const tabs = state.tabs.slice();
      tabs[index] = { ...current, content: action.content, isDirty: true };
      return { ...state, tabs };
    }

    case 'set-language': {
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, language: action.language } : tab,
        ),
      };
    }

    case 'mark-saved': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) {
        return state;
      }
      const current = state.tabs[index] as EditorTab;
      if (!current.isDirty && current.mtimeMs === action.mtimeMs) {
        return state;
      }
      const tabs = state.tabs.slice();
      tabs[index] = { ...current, isDirty: false, mtimeMs: action.mtimeMs };
      return { ...state, tabs };
    }

    case 'set-file-path': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) {
        return state;
      }
      const current = state.tabs[index] as EditorTab;
      const tabs = state.tabs.slice();
      tabs[index] = {
        ...current,
        filePath: action.filePath,
        name: action.name,
        language: action.language ?? current.language,
        mtimeMs: action.mtimeMs,
        isDirty: false,
      };
      return { ...state, tabs };
    }

    case 'rename-file': {
      let changed = false;
      let newActiveTabId = state.activeTabId;
      const tabs = state.tabs.map((tab) => {
        if (tab.filePath === null) {
          return tab;
        }
        const isTarget = pathsEqual(tab.filePath, action.path);
        const isInside =
          action.isDirectory && isPathInside(tab.filePath, action.path);
        if (!isTarget && !isInside) {
          return tab;
        }
        changed = true;
        const newPath = isTarget
          ? action.newPath
          : action.newPath + tab.filePath.slice(action.path.length);
        const newId = tab.id === tab.filePath ? newPath : tab.id;
        if (tab.id === state.activeTabId) {
          newActiveTabId = newId;
        }
        return {
          ...tab,
          filePath: newPath,
          name: isTarget ? baseName(newPath) : tab.name,
          // File-backed tab ids ARE their path — keep them in sync so tab
          // reuse (open-by-path) and the Monaco model registry stay keyed
          // correctly after a rename.
          id: newId,
        };
      });
      if (!changed) {
        return state;
      }
      return { ...state, tabs, activeTabId: newActiveTabId };
    }

    case 'close-by-path': {
      const remaining = state.tabs.filter((tab) => {
        if (tab.filePath === null) {
          return true;
        }
        if (pathsEqual(tab.filePath, action.path)) {
          return false;
        }
        return !(
          action.isDirectory && isPathInside(tab.filePath, action.path)
        );
      });
      if (remaining.length === state.tabs.length) {
        return state;
      }
      const closedActive = !remaining.some(
        (tab) => tab.id === state.activeTabId,
      );
      if (!closedActive) {
        return { ...state, tabs: remaining };
      }
      // Activate a neighbour of the first closed tab (spec §8.2): prefer the
      // next surviving tab after it, else the closest surviving one before.
      const firstClosedIndex = state.tabs.findIndex(
        (tab) => !remaining.some((kept) => kept.id === tab.id),
      );
      const after = state.tabs
        .slice(firstClosedIndex + 1)
        .find((tab) => remaining.some((kept) => kept.id === tab.id));
      const before = state.tabs
        .slice(0, firstClosedIndex)
        .reverse()
        .find((tab) => remaining.some((kept) => kept.id === tab.id));
      const neighbour = after ?? before ?? null;
      return { ...state, tabs: remaining, activeTabId: neighbour?.id ?? null };
    }

    case 'reload-content': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) {
        return state;
      }
      const current = state.tabs[index] as EditorTab;
      if (current.isDirty && action.force !== true) {
        // Never clobber unsaved work — the conflict flow owns dirty buffers.
        return state;
      }
      if (
        current.content === action.content &&
        current.mtimeMs === action.mtimeMs
      ) {
        return state;
      }
      const tabs = state.tabs.slice();
      tabs[index] = {
        ...current,
        content: action.content,
        mtimeMs: action.mtimeMs,
        isDirty: false,
      };
      return { ...state, tabs };
    }

    default:
      return state;
  }
}

/** Case-insensitive absolute-path equality (win32 drives are case-insensitive). */
function pathsEqual(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** True when `child` lives strictly below `parent`. */
function isPathInside(child: string, parent: string): boolean {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const base = parent.endsWith(separator) ? parent : parent + separator;
  return (
    child.startsWith(base) || child.toLowerCase().startsWith(base.toLowerCase())
  );
}

/** Last segment of an absolute path. */
function baseName(p: string): string {
  const index = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return index === -1 ? p : p.slice(index + 1);
}
