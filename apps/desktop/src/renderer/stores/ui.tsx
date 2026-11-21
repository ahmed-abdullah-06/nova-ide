import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ActivityId } from '../components/layout/ActivityBar';
import type { BottomPanelTab } from '../commands/types';

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

interface UiContextValue {
  activity: ActivityId;
  setActivity: (activity: ActivityId) => void;
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  bottomPanelTab: BottomPanelTab;
  /** True while the bottom panel occupies the whole editor column. */
  bottomPanelMaximized: boolean;
  aiPanelVisible: boolean;
  layoutSignal: number;
  explorerFocusSignal: number;
  searchFocusSignal: number;
  createFileSignal: number;
  /** Incremented to ask the mounted terminal panel to create a session. */
  terminalCreateSignal: number;
  windowState: WindowState;
  setWindowState: (state: WindowState) => void;
  toggleActivity: (activity: ActivityId) => void;
  showActivity: (activity: ActivityId, focus?: boolean) => void;
  /** Hides/shows the side bar without changing the active activity. */
  toggleSidebar: () => void;
  toggleBottomPanel: (tab?: BottomPanelTab) => void;
  selectBottomPanelTab: (tab: BottomPanelTab) => void;
  hideBottomPanel: () => void;
  toggleBottomPanelMaximized: () => void;
  toggleAiPanel: () => void;
  requestNewFile: () => void;
  /** Shows the terminal tab and asks its panel to create a new session. */
  requestNewTerminal: () => void;
}

const UiContext = createContext<UiContextValue | null>(null);

/**
 * Visibility and focus state for the main layout. Panels stay mounted and are
 * hidden with CSS so terminal sessions and Monaco history survive toggles.
 */
export function UiProvider({ children }: { children: ReactNode }): ReactNode {
  const [activity, setActivityState] = useState<ActivityId>('explorer');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('terminal');
  const [bottomPanelMaximized, setBottomPanelMaximized] = useState(false);
  const [aiPanelVisible, setAiPanelVisible] = useState(false);
  const [layoutSignal, setLayoutSignal] = useState(0);
  const [explorerFocusSignal, setExplorerFocusSignal] = useState(0);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [createFileSignal, setCreateFileSignal] = useState(0);
  const [terminalCreateSignal, setTerminalCreateSignal] = useState(0);
  const [windowState, setWindowState] = useState<WindowState>({
    maximized: false,
    fullScreen: false,
  });

  const bumpLayout = useCallback(() => {
    setLayoutSignal((signal) => signal + 1);
  }, []);

  const setActivity = useCallback((next: ActivityId) => {
    setActivityState(next);
  }, []);

  const showActivity = useCallback(
    (next: ActivityId, focus = false) => {
      setActivityState(next);
      setSidebarVisible(true);
      if (focus) {
        if (next === 'explorer') {
          setExplorerFocusSignal((signal) => signal + 1);
        } else if (next === 'search') {
          setSearchFocusSignal((signal) => signal + 1);
        }
      }
      bumpLayout();
    },
    [bumpLayout],
  );

  const toggleActivity = useCallback(
    (next: ActivityId) => {
      if (sidebarVisible && activity === next) {
        setSidebarVisible(false);
        bumpLayout();
        return;
      }
      showActivity(next, true);
    },
    [activity, bumpLayout, showActivity, sidebarVisible],
  );

  const toggleSidebar = useCallback((): void => {
    setSidebarVisible((visible) => !visible);
    bumpLayout();
  }, [bumpLayout]);

  const toggleBottomPanel = useCallback(
    (tab: BottomPanelTab = 'terminal') => {
      if (bottomPanelVisible) {
        // Never leave the editor collapsed when the maximized panel is hidden.
        setBottomPanelVisible(false);
        setBottomPanelMaximized(false);
      } else {
        setBottomPanelTab(tab);
        setBottomPanelVisible(true);
      }
      bumpLayout();
    },
    [bottomPanelVisible, bumpLayout],
  );

  const selectBottomPanelTab = useCallback(
    (tab: BottomPanelTab) => {
      setBottomPanelTab(tab);
      setBottomPanelVisible(true);
      bumpLayout();
    },
    [bumpLayout],
  );

  const hideBottomPanel = useCallback((): void => {
    setBottomPanelVisible(false);
    setBottomPanelMaximized(false);
    bumpLayout();
  }, [bumpLayout]);

  const toggleBottomPanelMaximized = useCallback((): void => {
    setBottomPanelMaximized((maximized) => !maximized);
    bumpLayout();
  }, [bumpLayout]);

  const requestNewTerminal = useCallback((): void => {
    setBottomPanelTab('terminal');
    setBottomPanelVisible(true);
    setTerminalCreateSignal((signal) => signal + 1);
    bumpLayout();
  }, [bumpLayout]);

  const toggleAiPanel = useCallback(() => {
    setAiPanelVisible((visible) => !visible);
    bumpLayout();
  }, [bumpLayout]);

  const requestNewFile = useCallback(() => {
    setActivityState('explorer');
    setSidebarVisible(true);
    setCreateFileSignal((signal) => signal + 1);
    bumpLayout();
  }, [bumpLayout]);

  const value = useMemo<UiContextValue>(
    () => ({
      activity,
      setActivity,
      sidebarVisible,
      bottomPanelVisible,
      bottomPanelTab,
      bottomPanelMaximized,
      aiPanelVisible,
      layoutSignal,
      explorerFocusSignal,
      searchFocusSignal,
      createFileSignal,
      terminalCreateSignal,
      windowState,
      setWindowState,
      toggleActivity,
      showActivity,
      toggleSidebar,
      toggleBottomPanel,
      selectBottomPanelTab,
      hideBottomPanel,
      toggleBottomPanelMaximized,
      toggleAiPanel,
      requestNewFile,
      requestNewTerminal,
    }),
    [
      activity,
      aiPanelVisible,
      bottomPanelMaximized,
      bottomPanelTab,
      bottomPanelVisible,
      createFileSignal,
      explorerFocusSignal,
      hideBottomPanel,
      layoutSignal,
      requestNewFile,
      requestNewTerminal,
      searchFocusSignal,
      setActivity,
      selectBottomPanelTab,
      showActivity,
      sidebarVisible,
      terminalCreateSignal,
      toggleActivity,
      toggleAiPanel,
      toggleSidebar,
      toggleBottomPanel,
      toggleBottomPanelMaximized,
      windowState,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const context = useContext(UiContext);
  if (context === null) {
    throw new Error('useUi must be used inside <UiProvider>');
  }
  return context;
}
