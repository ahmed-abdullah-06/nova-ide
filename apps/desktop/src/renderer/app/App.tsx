import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, NovaApi, SearchMatch } from '../../shared/ipc-types';
import { useTheme } from '../hooks/useTheme';
import { TabsProvider, useTabs } from '../stores/tabs';
import { WorkspaceProvider, useWorkspace } from '../stores/workspace';
import { UiProvider, useUi } from '../stores/ui';
import { useWorkspaceActions } from '../features/workspace/hooks/useWorkspaceActions';
import { useFileOpener } from '../features/workspace/hooks/useFileOpener';
import { useExternalFileChanges } from '../features/workspace/hooks/useExternalFileChanges';
import { NotificationHost } from '../features/workspace/components/NotificationHost';
import { ActivityBar } from '../components/layout/ActivityBar';
import { AiPanel } from '../features/ai/AiPanel';
import { AiProvider, useAiContext } from '../features/ai/AiContext';
import { BottomPanel } from '../components/layout/BottomPanel';
import { TitleBar } from '../components/layout/TitleBar';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBar } from '../components/layout/StatusBar';
import { EditorArea } from '../features/editor/EditorArea';
import { TerminalPanel } from '../features/terminal/TerminalPanel';
import { VoiceSettingsProvider } from '../features/voice/VoiceSettingsContext';
import { ProblemsPanel } from '../features/problems/ProblemsPanel';
import { TaskOutputPanel } from '../features/tasks/TaskOutputPanel';
import { useTasks } from '../features/tasks/useTasks';
import { useProblems } from '../features/problems/useProblems';
import { CommandProvider, useCommands } from '../commands/CommandProvider';
import { requestEditorLayout } from '../features/editor/editorCommands';

interface CursorPosition {
  line: number;
  column: number;
}

/**
 * Application layout (spec §6.1): Menu bar · Activity bar · Sidebar · Editor
 * area · AI panel · Terminal panel · Status bar.
 */
function Workspace(): ReactNode {
  const { theme, toggleTheme } = useTheme();
  const { state, dispatch, openSettings } = useTabs();
  const { state: workspaceState } = useWorkspace();
  const workspaceActions = useWorkspaceActions();
  const ui = useUi();
  const commands = useCommands();
  const ai = useAiContext();
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [selection, setSelection] = useState<{
    startLine: number;
    endLine: number;
  } | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const { openFile } = useFileOpener();
  const hasWorkspace = workspaceState.workspace !== null;
  useExternalFileChanges();

  const handleOpenSearchResult = (match: SearchMatch): void => {
    void openFile(match.path, { line: match.line, column: match.column });
  };

  const handleOpenFile = (path: string): void => {
    void openFile(path);
  };

  // The badge of the problems tab shows how many diagnostics the language
  // services reported for the open files.
  const problems = useProblems();

  // The task runner offers the scripts of the workspace package.json.
  const tasks = useTasks(hasWorkspace);

  // Monaco must be re-measured whenever a panel is shown, hidden, resized,
  // or the window itself changes size. Panels stay mounted (CSS-only hiding).
  useEffect(() => {
    requestEditorLayout();
    const handleResize = (): void => requestEditorLayout();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [ui.layoutSignal]);

  // The workspace can be changed outside the renderer (another window, or
  // the main process), so the renderer re-reads it when it gains focus.
  useEffect(() => {
    const handleFocus = (): void => {
      void workspaceActions.syncActiveWorkspace();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [workspaceActions]);

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
  const settingsActive = activeTab?.kind === 'settings';
  /** The Settings tab is not a file buffer and has no editor context. */
  const fileTab = settingsActive ? null : activeTab;

  /** One entry point for the gear and Ctrl+,: open the Settings tab. */
  const handleOpenSettings = (): void => {
    ui.showActivity('settings');
    openSettings();
  };

  const handleLanguageChange = (language: string): void => {
    if (fileTab) {
      dispatch({ type: 'set-language', id: fileTab.id, language });
    }
  };

  const shellClass = [
    'app-shell',
    ui.sidebarVisible ? '' : 'app-shell--no-sidebar',
    ui.aiPanelVisible ? '' : 'app-shell--no-ai',
  ]
    .filter((value) => value !== '')
    .join(' ');

  return (
    <div className={shellClass}>
      <TitleBar
        sections={commands.sections}
        chordHint={commands.chordHint}
        onExecute={commands.executeFromMenu}
        onCaptureFocus={commands.captureMenuFocus}
        onOpenChange={commands.setMenuOpen}
        title={
          activeTab !== null
            ? `${activeTab.name} — ${workspaceState.workspace?.name ?? 'A6'}`
            : (workspaceState.workspace?.name ?? 'A6')
        }
        aiPanelVisible={ui.aiPanelVisible}
        onToggleAiPanel={ui.toggleAiPanel}
        onOpenSettings={handleOpenSettings}
      />
      <ActivityBar
        active={ui.activity}
        onSelect={(id) => {
          if (id === 'settings') {
            handleOpenSettings();
          } else {
            ui.showActivity(id);
          }
        }}
      />
      <Sidebar
        activity={ui.activity}
        theme={theme}
        onToggleTheme={toggleTheme}
        focusSignal={ui.explorerFocusSignal}
        createFileSignal={ui.createFileSignal}
        hasWorkspace={hasWorkspace}
        onOpenSearchResult={handleOpenSearchResult}
        onOpenFile={handleOpenFile}
        visible={ui.sidebarVisible}
      />
      <div
        className={`main-column${ui.bottomPanelVisible ? '' : ' main-column--no-bottom-panel'}`}
      >
        <EditorArea
          theme={theme}
          onCursorChange={setCursor}
          onSelectionChange={setSelection}
        />
        <BottomPanel
          renderTerminal={() => <TerminalPanel hasWorkspace={hasWorkspace} />}
          problemCount={problems.errorCount}
          renderOutput={() => (
            <TaskOutputPanel
              tasks={tasks.tasks}
              runningTask={tasks.runningTask}
              output={tasks.output}
              onRun={tasks.run}
              onStop={tasks.stop}
              onRefresh={tasks.refresh}
            />
          )}
          renderProblems={() => (
            <ProblemsPanel
              onOpenProblem={(entry) =>
                handleOpenSearchResult({
                  path: entry.path,
                  relativePath: entry.path,
                  name: entry.path,
                  line: entry.line,
                  column: entry.column,
                  preview: entry.message,
                })
              }
            />
          )}
          active={ui.bottomPanelTab}
          onSelectTab={ui.selectBottomPanelTab}
          visible={ui.bottomPanelVisible}
        />
      </div>
      <AiPanel
        hasWorkspace={hasWorkspace}
        activeFile={
          fileTab !== null
            ? {
                path: fileTab.id,
                name: fileTab.name,
                sizeBytes: fileTab.content.length,
              }
            : null
        }
        selection={
          selection !== null && fileTab !== null
            ? {
                path: fileTab.id,
                name: fileTab.name,
                sizeBytes: 0,
                startLine: selection.startLine,
                endLine: selection.endLine,
              }
            : null
        }
        visible={ui.aiPanelVisible}
      />
      <StatusBar
        language={settingsActive ? null : (fileTab?.language ?? null)}
        onLanguageChange={handleLanguageChange}
        cursor={settingsActive ? { line: 1, column: 1 } : cursor}
        theme={theme}
        onToggleTheme={toggleTheme}
        appInfo={appInfo}
        workspaceName={workspaceState.workspace?.name ?? null}
        workspaceRoot={workspaceState.workspace?.rootPath ?? null}
        localOnly={ai.localOnly}
      />
      <NotificationHost />
    </div>
  );
}

export function App(): ReactNode {
  return (
    <TabsProvider>
      <WorkspaceProvider>
        <UiProvider>
          <AiProvider>
            <VoiceSettingsProvider>
              <CommandProvider>
                <Workspace />
              </CommandProvider>
            </VoiceSettingsProvider>
          </AiProvider>
        </UiProvider>
      </WorkspaceProvider>
    </TabsProvider>
  );
}
