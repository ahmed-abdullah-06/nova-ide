import type { ReactNode } from 'react';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { COMMAND_IDS } from '../../commands/catalog';
import { useCommands } from '../../commands/CommandProvider';
import type { Theme } from '../../hooks/useTheme';
import { SettingsView } from '../settings/SettingsView';
import { Breadcrumbs } from './Breadcrumbs';
import { EditorTabs } from './EditorTabs';
import { MonacoEditor } from './MonacoEditor';
import { WelcomeView } from '../welcome/WelcomeView';

interface EditorAreaProps {
  theme: Theme;
  onToggleTheme: () => void;
  onCursorChange: (position: { line: number; column: number }) => void;
  /** Reports the selected lines (the context of the chat). */
  onSelectionChange?: (
    selection: { startLine: number; endLine: number } | null,
  ) => void;
}

/** Tab strip + Monaco editor composition (spec §6.1, §8). */
export function EditorArea({
  theme,
  onToggleTheme,
  onCursorChange,
  onSelectionChange,
}: EditorAreaProps): ReactNode {
  const { state, dispatch } = useTabs();
  const { state: workspaceState } = useWorkspace();
  const { executeFromMenu } = useCommands();
  const activeTab =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const settingsActive = activeTab?.kind === 'settings';
  const welcomeActive = activeTab?.kind === 'welcome';

  const handleActivate = (id: string): void => {
    dispatch({ type: 'activate', id });
  };

  const handleClose = (id: string): void => {
    // The registry service owns dirty confirmation and model disposal.
    executeFromMenu(COMMAND_IDS.closeTabById, id);
  };

  const handleNew = (): void => {
    dispatch({ type: 'new-untitled', language: 'plaintext' });
  };

  const handleChange = (content: string): void => {
    if (activeTab) {
      dispatch({ type: 'update-content', id: activeTab.id, content });
    }
  };

  return (
    <div className="editor-area">
      <EditorTabs
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onActivate={handleActivate}
        onClose={handleClose}
        onNew={handleNew}
        onContextAction={(id, tabId) => executeFromMenu(id, tabId)}
      />
      <Breadcrumbs
        tab={activeTab}
        workspaceRoot={workspaceState.workspace?.rootPath ?? null}
        workspaceName={workspaceState.workspace?.name ?? null}
      />
      {welcomeActive ? (
        <WelcomeView recent={workspaceState.recent} />
      ) : settingsActive ? (
        <SettingsView theme={theme} onToggleTheme={onToggleTheme} />
      ) : (
        <MonacoEditor
          tab={activeTab}
          theme={theme}
          onChange={handleChange}
          onCursorChange={onCursorChange}
          onSelectionChange={onSelectionChange}
        />
      )}
    </div>
  );
}
