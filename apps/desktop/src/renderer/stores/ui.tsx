import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ActivityId } from '../components/layout/ActivityBar';
import type { BottomPanelTab } from '../commands/types';
import {
  AI_PANEL_WIDTH_RANGE,
  BOTTOM_PANEL_HEIGHT_RANGE,
  SIDEBAR_WIDTH_RANGE,
  clampSashSize,
  type SashRange,
} from '../features/layout/sashModel';

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

/** Renderer-local size persistence, mirroring the existing theme preference. */
const LAYOUT_STORAGE_PREFIX = 'nova.layout.';

function readStoredSize(
  key: string,
  fallback: number,
  range: SashRange,
): number {
  try {
    const raw = window.localStorage.getItem(`${LAYOUT_STORAGE_PREFIX}${key}`);
    if (raw === null) {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSashSize(parsed, range) : fallback;
  } catch {
    return fallback;
  }
}

function persistSize(key: string, value: number): void {
  try {
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}${key}`, String(value));
  } catch {
    // Storage may be unavailable; sizes still work for the current session.
  }
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
  /** Persisted pane sizes driven by the LF5 sashes, in CSS pixels. */
  sidebarWidth: number;
  bottomPanelHeight: number;
  aiPanelWidth: number;
  setSidebarWidth: (value: number) => void;
  setBottomPanelHeight: (value: number) => void;
  setAiPanelWidth: (value: number) => void;
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
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    readStoredSize('sidebarWidth', 260, SIDEBAR_WIDTH_RANGE),
  );
  const [bottomPanelHeight, setBottomPanelHeightState] = useState(() =>
    readStoredSize('bottomPanelHeight', 200, BOTTOM_PANEL_HEIGHT_RANGE),
  );
  const [aiPanelWidth, setAiPanelWidthState] = useState(() =>
    readStoredSize('aiPanelWidth', 320, AI_PANEL_WIDTH_RANGE),
  );

  // Refs keep pointer-move updates from re-bumping layout when a size is
  // already clamped to the same pixel value.
  const sidebarWidthRef = useRef(sidebarWidth);
  const bottomPanelHeightRef = useRef(bottomPanelHeight);
  const aiPanelWidthRef = useRef(aiPanelWidth);
  sidebarWidthRef.current = sidebarWidth;
  bottomPanelHeightRef.current = bottomPanelHeight;
  aiPanelWidthRef.current = aiPanelWidth;

  useEffect(() => {
    persistSize('sidebarWidth', sidebarWidth);
  }, [sidebarWidth]);
  useEffect(() => {
    persistSize('bottomPanelHeight', bottomPanelHeight);
  }, [bottomPanelHeight]);
  useEffect(() => {
    persistSize('aiPanelWidth', aiPanelWidth);
  }, [aiPanelWidth]);

  const bumpLayout = useCallback(() => {
    setLayoutSignal((signal) => signal + 1);
  }, []);

  const setSidebarWidth = useCallback(
    (value: number) => {
      const next = clampSashSize(value, SIDEBAR_WIDTH_RANGE);
      if (next === sidebarWidthRef.current) {
        return;
      }
      sidebarWidthRef.current = next;
      setSidebarWidthState(next);
      bumpLayout();
    },
    [bumpLayout],
  );

  const setBottomPanelHeight = useCallback(
    (value: number) => {
      const next = clampSashSize(value, BOTTOM_PANEL_HEIGHT_RANGE);
      if (next === bottomPanelHeightRef.current) {
        return;
      }
      bottomPanelHeightRef.current = next;
      setBottomPanelHeightState(next);
      bumpLayout();
    },
    [bumpLayout],
  );

  const setAiPanelWidth = useCallback(
    (value: number) => {
      const next = clampSashSize(value, AI_PANEL_WIDTH_RANGE);
      if (next === aiPanelWidthRef.current) {
        return;
      }
      aiPanelWidthRef.current = next;
      setAiPanelWidthState(next);
      bumpLayout();
    },
    [bumpLayout],
  );

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
      sidebarWidth,
      bottomPanelHeight,
      aiPanelWidth,
      setSidebarWidth,
      setBottomPanelHeight,
      setAiPanelWidth,
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
      aiPanelWidth,
      bottomPanelHeight,
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
      setAiPanelWidth,
      setBottomPanelHeight,
      setSidebarWidth,
      selectBottomPanelTab,
      showActivity,
      sidebarVisible,
      sidebarWidth,
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
