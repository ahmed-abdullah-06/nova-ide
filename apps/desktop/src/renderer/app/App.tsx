import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { SearchMatch } from '../../shared/ipc-types';
import { useTheme } from '../hooks/useTheme';
import { TabsProvider, useTabs } from '../stores/tabs';
import { WorkspaceProvider, useWorkspace } from '../stores/workspace';
import { UiProvider, useUi } from '../stores/ui';
import { useWorkspaceActions } from '../features/workspace/hooks/useWorkspaceActions';
import { useFileOpener } from '../features/workspace/hooks/useFileOpener';
import { useExternalFileChanges } from '../features/workspace/hooks/useExternalFileChanges';
import {
  AI_PANEL_WIDTH_RANGE,
  BOTTOM_PANEL_HEIGHT_RANGE,
  SIDEBAR_WIDTH_RANGE,
} from '../features/layout/sashModel';
import { NotificationHost } from '../features/workspace/components/NotificationHost';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { ActivityBar } from '../components/layout/ActivityBar';
import { AiPanel } from '../features/ai/AiPanel';
import { AiProvider, useAiContext } from '../features/ai/AiContext';
import { BottomPanel } from '../components/layout/BottomPanel';
import { TitleBar } from '../components/layout/TitleBar';
import { Sash } from '../components/layout/Sash';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBar } from '../components/layout/StatusBar';
import { EditorArea } from '../features/editor/EditorArea';
import { TerminalPanel } from '../features/terminal/TerminalPanel';
import { VoiceSettingsProvider } from '../features/voice/VoiceSettingsContext';
import { ProblemsPanel } from '../features/problems/ProblemsPanel';
import { TaskOutputPanel } from '../features/tasks/TaskOutputPanel';
import { useTasks } from '../features/tasks/useTasks';
import { useProblems } from '../features/problems/useProblems';
import { useGit } from '../features/git/useGit';
import { CommandProvider, useCommands } from '../commands/CommandProvider';
import { COMMAND_IDS } from '../commands/catalog';
import { requestEditorLayout } from '../features/editor/editorCommands';
import {
  detectEol,
  formatIndentation,
  summarizeGitStatus,
} from '../features/status/statusBarModel';

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
  // Drives the Source Control change-count badge in the activity bar.
  const git = useGit(hasWorkspace);
  const gitChangeCount = git.status?.isRepository === true
    ? git.status.staged.length +
      git.status.unstaged.length +
      git.status.untracked.length
    : 0;
  const gitSummary = summarizeGitStatus(git.status);

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

  // Inherited CSS variables drive the existing pane width/height rules, so no
  // pane component needs to know that a sash changed its size.
  const shellStyle = {
    '--sidebar-width': `${ui.sidebarWidth}px`,
    '--bottompanel-height': `${ui.bottomPanelHeight}px`,
    '--ai-panel-width': `${ui.aiPanelWidth}px`,
  } as CSSProperties;

  return (
    <div className={shellClass} style={shellStyle}>
      <TitleBar
        sections={commands.sections}
        chordHint={commands.chordHint}
        paletteShortcut={commands.paletteShortcut}
        onExecute={commands.executeFromMenu}
        onCaptureFocus={commands.captureMenuFocus}
        onOpenChange={commands.setMenuOpen}
        title={
          activeTab !== null
            ? `${activeTab.name} — ${workspaceState.workspace?.name ?? 'A6'}`
            : (workspaceState.workspace?.name ?? 'A6')
        }
        aiPanelVisible={ui.aiPanelVisible}
        sidebarVisible={ui.sidebarVisible}
        bottomPanelVisible={ui.bottomPanelVisible}
        onToggleAiPanel={ui.toggleAiPanel}
        onToggleSidebar={() =>
          commands.executeFromMenu(COMMAND_IDS.toggleExplorer)
        }
        onToggleBottomPanel={() =>
          commands.executeFromMenu(COMMAND_IDS.toggleTerminal)
        }
      />
      <ActivityBar
        active={ui.activity}
        changeCount={gitChangeCount}
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
        focusSignal={ui.explorerFocusSignal}
        createFileSignal={ui.createFileSignal}
        hasWorkspace={hasWorkspace}
        onOpenSearchResult={handleOpenSearchResult}
        onOpenFile={handleOpenFile}
        visible={ui.sidebarVisible}
      />
      {ui.sidebarVisible && (
        <Sash
          placement="sidebar"
          label="Resize sidebar"
          orientation="vertical"
          axis="x"
          direction={1}
          value={ui.sidebarWidth}
          range={SIDEBAR_WIDTH_RANGE}
          onChange={ui.setSidebarWidth}
        />
      )}
      <div
        className={[
          'main-column',
          ui.bottomPanelVisible ? '' : 'main-column--no-bottom-panel',
          ui.bottomPanelMaximized ? 'main-column--panel-maximized' : '',
        ]
          .filter((value) => value !== '')
          .join(' ')}
      >
        <EditorArea
          theme={theme}
          onToggleTheme={toggleTheme}
          onCursorChange={setCursor}
          onSelectionChange={setSelection}
        />
        {ui.bottomPanelVisible && !ui.bottomPanelMaximized && (
          <Sash
            placement="bottom"
            label="Resize bottom panel"
            orientation="horizontal"
            axis="y"
            direction={-1}
            value={ui.bottomPanelHeight}
            range={BOTTOM_PANEL_HEIGHT_RANGE}
            onChange={ui.setBottomPanelHeight}
          />
        )}
        <BottomPanel
          maximized={ui.bottomPanelMaximized}
          onNewTerminal={() =>
            commands.executeFromMenu(COMMAND_IDS.newTerminal)
          }
          onToggleMaximize={() =>
            commands.executeFromMenu(COMMAND_IDS.maximizeBottomPanel)
          }
          onClose={() =>
            commands.executeFromMenu(COMMAND_IDS.closeBottomPanel)
          }
          renderTerminal={() => (
            <TerminalPanel
              hasWorkspace={hasWorkspace}
              theme={theme}
              createSignal={ui.terminalCreateSignal}
            />
          )}
          problemCount={problems.errorCount}
          renderOutput={() => (
            <TaskOutputPanel
              hasWorkspace={hasWorkspace}
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
      {ui.aiPanelVisible && (
        <Sash
          placement="ai"
          label="Resize AI panel"
          orientation="vertical"
          axis="x"
          direction={-1}
          value={ui.aiPanelWidth}
          range={AI_PANEL_WIDTH_RANGE}
          onChange={ui.setAiPanelWidth}
        />
      )}
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
        workspaceName={workspaceState.workspace?.name ?? null}
        workspaceRoot={workspaceState.workspace?.rootPath ?? null}
        localOnly={ai.localOnly}
        gitSummary={gitSummary}
        errorCount={problems.errorCount}
        warningCount={problems.warningCount}
        indentation={formatIndentation(2)}
        eol={detectEol(fileTab?.content ?? '')}
        hasBuffer={fileTab !== null}
        notifications={workspaceState.notificationHistory}
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
              <ConfirmProvider>
                <CommandProvider>
                  <Workspace />
                </CommandProvider>
              </ConfirmProvider>
            </VoiceSettingsProvider>
          </AiProvider>
        </UiProvider>
      </WorkspaceProvider>
    </TabsProvider>
  );
}
