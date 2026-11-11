/**
 * Opens files in the editor (spec §8).
 *
 * A single implementation of the "open a file, reusing an existing tab"
 * behaviour, shared by the explorer, the search results, the problems
 * panel and the source control view.
 */
import { useCallback } from 'react';
import { useTabs } from '../../../stores/tabs';
import { useWorkspace } from '../../../stores/workspace';
import { detectLanguage } from '../../../utils/language';
import { requestReveal } from '../../editor/editorCommands';

export interface OpenFileOptions {
  /** 1-based line to reveal after the file was opened. */
  line?: number;
  /** 1-based column to reveal after the file was opened. */
  column?: number;
}

export interface FileOpener {
  /**
   * Opens a file in the editor.
   *
   * When the file is already open, its tab is activated instead of being
   * duplicated.
   */
  openFile: (path: string, options?: OpenFileOptions) => Promise<void>;
}

export function useFileOpener(): FileOpener {
  const { state: tabsState, dispatch: tabsDispatch } = useTabs();
  const { dispatch } = useWorkspace();

  const openFile = useCallback(
    async (path: string, options: OpenFileOptions = {}): Promise<void> => {
      const api = window.nova;
      if (!api) {
        return;
      }

      const line = options.line ?? 1;
      const column = options.column ?? 1;

      const existing = tabsState.tabs.find((tab) => tab.filePath === path);
      if (existing !== undefined) {
        tabsDispatch({ type: 'activate', id: existing.id });
        requestReveal({ path: existing.id, line, column });
        return;
      }

      const result = await api.fs.readFile(path);
      if (!result.ok) {
        dispatch({ type: 'notify', kind: 'error', message: result.message });
        return;
      }

      const name = path.split(/[\\/]/).pop() ?? path;
      tabsDispatch({
        type: 'open',
        id: result.value.path,
        name,
        language: detectLanguage(name),
        content: result.value.content,
        filePath: result.value.path,
        mtimeMs: result.value.mtimeMs,
      });
      requestReveal({ path: result.value.path, line, column });
    },
    [dispatch, tabsDispatch, tabsState.tabs],
  );

  return { openFile };
}
