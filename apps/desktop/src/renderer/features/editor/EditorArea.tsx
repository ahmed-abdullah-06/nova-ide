import type { ReactNode } from 'react';
import { useTabs } from '../../stores/tabs';
import type { Theme } from '../../hooks/useTheme';
import { disposeModel } from './modelRegistry';
import { EditorTabs } from './EditorTabs';
import { MonacoEditor } from './MonacoEditor';

interface EditorAreaProps {
  theme: Theme;
  onCursorChange: (position: { line: number; column: number }) => void;
  /** Reports the selected lines (the context of the chat). */
  onSelectionChange?: (
    selection: { startLine: number; endLine: number } | null,
  ) => void;
}

/** Tab strip + Monaco editor composition (spec §6.1, §8). */
export function EditorArea({
  theme,
  onCursorChange,
  onSelectionChange,
}: EditorAreaProps): ReactNode {
  const { state, dispatch } = useTabs();
  const activeTab =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;

  const handleActivate = (id: string): void => {
    dispatch({ type: 'activate', id });
  };

  const handleClose = (id: string): void => {
    disposeModel(id);
    dispatch({ type: 'close', id });
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
      />
      <MonacoEditor
        tab={activeTab}
        theme={theme}
        onChange={handleChange}
        onCursorChange={onCursorChange}
        onSelectionChange={onSelectionChange}
      />
    </div>
  );
}
