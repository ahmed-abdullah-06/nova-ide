/**
 * Pure editor-tabs state machine (kept free of React/UI so it can be unit
 * tested directly — spec §24).
 */

export interface EditorTab {
  id: string;
  name: string;
  /** Monaco language id (e.g. "typescript", "plaintext"). */
  language: string;
  /** In-memory buffer content. Real file I/O arrives in Milestone 2. */
  content: string;
  isDirty: boolean;
}

export interface TabsState {
  tabs: EditorTab[];
  activeTabId: string | null;
  /** Counter used to name new untitled buffers (Untitled-1, Untitled-2, ...). */
  untitledCounter: number;
}

export type TabsAction =
  | { type: 'open'; id: string; name: string; language: string; content: string }
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
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id
            ? { ...tab, content: action.content, isDirty: true }
            : tab,
        ),
      };
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
