import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  initialTabsState,
  tabsReducer,
  type EditorTab,
  type TabsAction,
  type TabsState,
} from './tabsReducer';

/**
 * Editor starts with one empty scratch buffer (an honest in-memory
 * "Untitled-1" — no fake files are shown before a workspace can be opened).
 */
function createInitialTabsState(): TabsState {
  const firstTab: EditorTab = {
    id: 'untitled-1',
    name: 'Untitled-1',
    language: 'plaintext',
    content: '',
    isDirty: false,
    filePath: null,
    mtimeMs: null,
  };
  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
    untitledCounter: 1,
  };
}

interface TabsContextValue {
  state: TabsState;
  dispatch: Dispatch<TabsAction>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(
    tabsReducer,
    initialTabsState,
    createInitialTabsState,
  );
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider');
  }
  return context;
}
