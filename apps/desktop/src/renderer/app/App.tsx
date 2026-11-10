import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, NovaApi } from '../../shared/ipc-types';
import { useTheme } from '../hooks/useTheme';
import { TabsProvider, useTabs } from '../stores/tabs';
import { WorkspaceProvider, useWorkspace } from '../stores/workspace';
import { useWorkspaceActions } from '../features/workspace/hooks/useWorkspaceActions';
import { useFileOperations } from '../features/workspace/hooks/useFileOperations';
import { useExternalFileChanges } from '../features/workspace/hooks/useExternalFileChanges';
import { NotificationHost } from '../features/workspace/components/NotificationHost';
import { ActivityBar, type ActivityId } from '../components/layout/ActivityBar';
import { AiPanel } from '../components/layout/AiPanel';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBar } from '../components/layout/StatusBar';
import { TerminalPanel } from '../components/layout/TerminalPanel';
import { EditorArea } from '../features/editor/EditorArea';

interface CursorPosition {
  line: number;
  column: number;
}

/**
 * Application layout (spec §6.1): Activity bar · Sidebar · Editor area ·
 * AI panel · Terminal panel · Status bar.
 */
function Workspace(): ReactNode {
  const { theme, toggleTheme } = useTheme();
  const { state, dispatch } = useTabs();
  const { state: workspaceState } = useWorkspace();
  const workspaceActions = useWorkspaceActions();
  const [activity, setActivity] = useState<ActivityId>('explorer');
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [explorerFocusSignal, setExplorerFocusSignal] = useState(0);
  const { openFolder } = workspaceActions;
  const { saveActive } = useFileOperations();
  useExternalFileChanges();

  // Workspace shortcuts (spec §13): Ctrl/Cmd+Shift+E focuses the explorer,
  // Ctrl/Cmd+Shift+O opens a folder, Ctrl/Cmd+S saves the active buffer.
  // There is no native menu accelerator, so no conflict can occur.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        if (key === 'e') {
          event.preventDefault();
          setActivity('explorer');
          setExplorerFocusSignal((signal) => signal + 1);
        } else if (key === 'o') {
          event.preventDefault();
          void openFolder();
        }
        return;
      }
      if (key === 's' && !event.altKey) {
        event.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [openFolder, saveActive]);

  // Exercise the typed preload bridge once on startup.
  useEffect(() => {
    const bridge: NovaApi | undefined = window.nova;
    if (!bridge) {
      // Preload unavailable (e.g. page opened outside the Electron shell):
      // the status bar simply omits the version.
      return;
    }
    let cancelled = false;
    bridge
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch(() => {
        // Status bar simply omits the version if the bridge is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;

  const handleLanguageChange = (language: string): void => {
    if (activeTab) {
      dispatch({ type: 'set-language', id: activeTab.id, language });
    }
  };

  return (
    <div className="app-shell">
      <ActivityBar active={activity} onSelect={setActivity} />
      <Sidebar
        activity={activity}
        theme={theme}
        onToggleTheme={toggleTheme}
        focusSignal={explorerFocusSignal}
      />
      <div className="main-column">
        <EditorArea theme={theme} onCursorChange={setCursor} />
        <TerminalPanel />
      </div>
      <AiPanel />
      <StatusBar
        language={activeTab?.language ?? null}
        onLanguageChange={handleLanguageChange}
        cursor={cursor}
        theme={theme}
        onToggleTheme={toggleTheme}
        appInfo={appInfo}
        workspaceName={workspaceState.workspace?.name ?? null}
        workspaceRoot={workspaceState.workspace?.rootPath ?? null}
      />
      <NotificationHost />
    </div>
  );
}

export function App(): ReactNode {
  return (
    <TabsProvider>
      <WorkspaceProvider>
        <Workspace />
      </WorkspaceProvider>
    </TabsProvider>
  );
}
