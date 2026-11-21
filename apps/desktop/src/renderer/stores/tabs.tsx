import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  initialTabsState,
  tabsReducer,
  WELCOME_TAB_ID,
  type EditorTab,
  type TabsAction,
  type TabsState,
} from './tabsReducer';

/**
 * Editor starts with the Welcome tab: an honest empty state with real Start,
 * Recent and Help actions, instead of an empty scratch buffer pretending to
 * be a document.
 */
function createInitialTabsState(): TabsState {
  const welcomeTab: EditorTab = {
    id: WELCOME_TAB_ID,
    name: 'Welcome',
    language: '',
    content: '',
    isDirty: false,
    filePath: null,
    origin: 'workspace',
    mtimeMs: null,
    kind: 'welcome',
  };
  return {
    tabs: [welcomeTab],
    activeTabId: welcomeTab.id,
    untitledCounter: 0,
  };
}

interface TabsContextValue {
  state: TabsState;
  dispatch: Dispatch<TabsAction>;
  /** Opens (or focuses) the one Settings editor tab. */
  openSettings: () => void;
  /** Opens (or focuses) the one Welcome editor tab. */
  openWelcome: () => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(
    tabsReducer,
    initialTabsState,
    createInitialTabsState,
  );
  const openSettings = useCallback(() => {
    dispatch({ type: 'open-settings' });
  }, []);
  const openWelcome = useCallback(() => {
    dispatch({ type: 'open-welcome' });
  }, []);
  const value = useMemo(
    () => ({ state, dispatch, openSettings, openWelcome }),
    [state, openSettings, openWelcome],
  );
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider');
  }
  return context;
}
