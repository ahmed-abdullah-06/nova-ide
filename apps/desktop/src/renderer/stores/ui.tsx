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
  aiPanelVisible: boolean;
  layoutSignal: number;
  explorerFocusSignal: number;
  searchFocusSignal: number;
  createFileSignal: number;
  windowState: WindowState;
  setWindowState: (state: WindowState) => void;
  toggleActivity: (activity: ActivityId) => void;
  showActivity: (activity: ActivityId, focus?: boolean) => void;
  toggleBottomPanel: (tab?: BottomPanelTab) => void;
  selectBottomPanelTab: (tab: BottomPanelTab) => void;
  toggleAiPanel: () => void;
  requestNewFile: () => void;
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
  const [aiPanelVisible, setAiPanelVisible] = useState(false);
  const [layoutSignal, setLayoutSignal] = useState(0);
  const [explorerFocusSignal, setExplorerFocusSignal] = useState(0);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [createFileSignal, setCreateFileSignal] = useState(0);
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

  const toggleBottomPanel = useCallback(
    (tab: BottomPanelTab = 'terminal') => {
      setBottomPanelVisible((visible) => {
        if (!visible) {
          setBottomPanelTab(tab);
        }
        return !visible;
      });
      bumpLayout();
    },
    [bumpLayout],
  );

  const selectBottomPanelTab = useCallback(
    (tab: BottomPanelTab) => {
      setBottomPanelTab(tab);
      setBottomPanelVisible(true);
      bumpLayout();
    },
    [bumpLayout],
  );

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
      aiPanelVisible,
      layoutSignal,
      explorerFocusSignal,
      searchFocusSignal,
      createFileSignal,
      windowState,
      setWindowState,
      toggleActivity,
      showActivity,
      toggleBottomPanel,
      selectBottomPanelTab,
      toggleAiPanel,
      requestNewFile,
    }),
    [
      activity,
      aiPanelVisible,
      bottomPanelTab,
      bottomPanelVisible,
      createFileSignal,
      explorerFocusSignal,
      layoutSignal,
      requestNewFile,
      searchFocusSignal,
      setActivity,
      selectBottomPanelTab,
      showActivity,
      sidebarVisible,
      toggleActivity,
      toggleAiPanel,
      toggleBottomPanel,
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
