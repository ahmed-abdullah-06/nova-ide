/**
 * Bridge for main → renderer filesystem events (spec §7.1, §19.3).
 *
 * Two responsibilities:
 *  1. keeps the main-process watch set equal to the set of open files
 *     (`fs:sync-open-files`; never a recursive workspace scan), and
 *  2. applies `fs:external-change` pushes to the editor:
 *       - clean buffer  → reload from disk (with an info toast),
 *       - dirty buffer  → explicit confirm before discarding local edits,
 *       - missing file  → warning toast; the buffer stays open so the user
 *                         can still review it (Ctrl+S offers to recreate it).
 *
 * Events caused by NOVA's own writes are ignored: the main watcher already
 * suppresses them, and the renderer double-checks the mtime.
 */
import { useEffect, useRef } from 'react';
import { useTabs } from '../../../stores/tabs';
import { useWorkspace } from '../../../stores/workspace';
import type { EditorTab } from '../../../stores/tabsReducer';

/** Case-insensitive absolute-path equality (win32 drives are insensitive). */
function samePath(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

export function useExternalFileChanges(): void {
  const { state: tabsState, dispatch: tabsDispatch } = useTabs();
  const { dispatch } = useWorkspace();

  // Latest state inside the long-lived subscription without re-subscribing.
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;

  // ---- 1. Watch set sync -------------------------------------------------
  const openPathsKey = tabsState.tabs
    .map((tab) => tab.filePath ?? '')
    .filter((path) => path !== '')
    .sort()
    .join('\n');
  const lastSyncedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!window.nova || openPathsKey === lastSyncedKeyRef.current) {
      return;
    }
    lastSyncedKeyRef.current = openPathsKey;
    const paths = openPathsKey === '' ? [] : openPathsKey.split('\n');
    // Best effort: a failed sync must not block editing; the main process
    // also clears all watches when the workspace closes.
    void window.nova.fs.syncOpenFiles(paths).catch(() => undefined);
  }, [openPathsKey]);

  // ---- 2. External change handling --------------------------------------
  useEffect(() => {
    if (!window.nova) {
      return;
    }
    const unsubscribe = window.nova.workspace.onExternalChange((change) => {
      const tabs = tabsRef.current.tabs;
      const tab: EditorTab | undefined = tabs.find(
        (candidate) =>
          candidate.filePath !== null && samePath(candidate.filePath, change.path),
      );
      if (tab === undefined || tab.filePath === null) {
        return; // not open in the editor — the explorer refresh handles it
      }
      // Echo of our own write (belt and braces on top of the main watcher).
      if (
        change.kind === 'changed' &&
        change.mtimeMs !== null &&
        tab.mtimeMs === change.mtimeMs &&
        !tab.isDirty
      ) {
        return;
      }

      if (change.kind === 'missing') {
        dispatch({
          type: 'notify',
          kind: 'warning',
          message: `"${tab.name}" was deleted outside NOVA — the buffer stays open (Ctrl+S recreates it)`,
        });
        return;
      }

      const adoptFromDisk = (): void => {
        void (async (): Promise<void> => {
          if (!window.nova || tab.filePath === null) {
            return;
          }
          const read = await window.nova.fs.readFile(tab.filePath);
          if (!read.ok) {
            dispatch({ type: 'notify', kind: 'error', message: read.message });
            return;
          }
          tabsDispatch({
            type: 'reload-content',
            id: tab.id,
            content: read.value.content,
            mtimeMs: read.value.mtimeMs,
            force: tab.isDirty,
          });
          dispatch({
            type: 'notify',
            kind: 'info',
            message: `"${tab.name}" was reloaded from disk (it changed externally)`,
          });
        })();
      };

      if (!tab.isDirty) {
        adoptFromDisk();
        return;
      }

      // Dirty buffer: never lose unsaved work without asking (spec §7.1).
      const discard = window.confirm(
        `"${tab.name}" changed on disk while you have unsaved changes here.\n\n` +
          `Load the version from disk and discard your changes?`,
      );
      if (discard) {
        adoptFromDisk();
      } else {
        dispatch({
          type: 'notify',
          kind: 'warning',
          message: `"${tab.name}" changed on disk — your unsaved edits are kept; Ctrl+S overwrites the file`,
        });
      }
    });
    return unsubscribe;
  }, [dispatch, tabsDispatch]);
}
