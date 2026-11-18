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
  /**
   * Opens the native main-process dialog. Files inside the workspace use the
   * normal path; files outside open under an exact, in-memory grant.
   */
  openFromDialog: () => Promise<void>;
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

  const openFromDialog = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api) {
      dispatch({
        type: 'notify',
        kind: 'error',
        message: 'File opening is unavailable outside A6',
      });
      return;
    }

    // The main process owns the dialog and the canonical result. The renderer
    // never sends a path to this channel.
    const chosen = await api.fs.openFileDialog();
    if (!chosen.ok) {
      dispatch({ type: 'notify', kind: 'error', message: chosen.message });
      return;
    }
    const selection = chosen.value;
    if (selection === null) {
      return; // cancelled
    }

    const existing = tabsState.tabs.find(
      (tab) => tab.filePath === selection.path,
    );
    if (existing !== undefined) {
      tabsDispatch({ type: 'activate', id: existing.id });
      requestReveal({ path: existing.id, line: 1, column: 1 });
      return;
    }
    if (selection.origin === 'workspace') {
      await openFile(selection.path);
      return;
    }

    // Outside the workspace: read and later save through the opaque grant.
    const grantId = selection.grantId;
    if (grantId === undefined) {
      dispatch({
        type: 'notify',
        kind: 'error',
        message: 'The selected file did not receive a save grant',
      });
      return;
    }
    const result = await api.fs.readExternal(grantId);
    if (!result.ok) {
      dispatch({ type: 'notify', kind: 'error', message: result.message });
      return;
    }
    tabsDispatch({
      type: 'open',
      id: result.value.path,
      name: selection.name,
      language: detectLanguage(selection.name),
      content: result.value.content,
      filePath: result.value.path,
      origin: 'external',
      externalGrantId: grantId,
      mtimeMs: result.value.mtimeMs,
    });
    requestReveal({ path: result.value.path, line: 1, column: 1 });
  }, [dispatch, openFile, tabsDispatch, tabsState.tabs]);

  return { openFile, openFromDialog };
}
