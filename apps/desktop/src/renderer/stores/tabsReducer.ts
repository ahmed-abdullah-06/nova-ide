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
  | { type: 'set-language'; id: string; language: string };

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

    default:
      return state;
  }
}
