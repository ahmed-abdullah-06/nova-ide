/**
 * Side-effectful file operations for Milestone 2 (spec §6, §7, §19.3).
 *
 * The reducer stays pure; this hook is the only renderer place that calls
 * `window.nova.fs` for mutations. Every call:
 *  - validates input cheaply up-front (empty names never reach IPC),
 *  - shows an explicit confirmation before destructive operations,
 *  - translates structured `FsResult` failures into notifications,
 *  - keeps editor tabs consistent with the disk (rename/delete/save).
 */
import { useCallback } from 'react';
import type { FileEntry, FileKind } from '../../../../shared/ipc-types';
import { useTabs } from '../../../stores/tabs';
import { useWorkspace } from '../../../stores/workspace';
import type { NotificationKind } from '../../../stores/workspaceReducer';
import { disposeModel, renameModelKey } from '../../editor/modelRegistry';
import { detectLanguage } from '../../../utils/language';
import { pathBaseName, pathJoin, pathParent } from '../../../utils/path';

export interface FileOperations {
  /** Creates a file/folder inside `parentPath` (inline input submit). */
  createEntry(parentPath: string, kind: FileKind, name: string): Promise<void>;
  /** Renames an entry in place (inline input submit). */
  renameEntry(entry: FileEntry, newName: string): Promise<void>;
  /** Deletes an entry after explicit confirmation. */
  deleteEntry(entry: FileEntry): Promise<void>;
  /** Ctrl+S: saves the active tab (Save-As dialog for untitled buffers). */
  saveActive(): Promise<void>;
}

export function useFileOperations(): FileOperations {
  const { state: tabsState, dispatch: tabsDispatch } = useTabs();
  const { state: workspaceState, dispatch } = useWorkspace();

  const notify = useCallback(
    (kind: NotificationKind, message: string): void => {
      dispatch({ type: 'notify', kind, message });
    },
    [dispatch],
  );

  const createEntry = useCallback(
    async (parentPath: string, kind: FileKind, name: string): Promise<void> => {
      if (!window.nova) {
        notify('error', 'Filesystem access is unavailable outside NOVA IDE');
        return;
      }
      const trimmed = name.trim();
      if (trimmed === '') {
        dispatch({ type: 'cancel-input' });
        return;
      }
      const target = pathJoin(parentPath, trimmed);
      const result =
        kind === 'directory'
          ? await window.nova.fs.createFolder(target)
          : await window.nova.fs.createFile(target);
      dispatch({ type: 'cancel-input' });
      if (!result.ok) {
        notify('error', result.message);
        return;
      }
      // Show the new entry immediately; expand folders so it is visible.
      dispatch({ type: 'reload', path: parentPath });
      if (kind === 'directory') {
        dispatch({ type: 'expand', path: result.value.path });
      }
      dispatch({ type: 'select', path: result.value.path });
      if (kind === 'file') {
        // Open the freshly created file, reusing openFile semantics.
        const read = await window.nova.fs.readFile(result.value.path);
        if (read.ok) {
          tabsDispatch({
            type: 'open',
            id: read.value.path,
            name: result.value.name,
            language: detectLanguage(result.value.name),
            content: read.value.content,
            filePath: read.value.path,
            mtimeMs: read.value.mtimeMs,
          });
        }
      }
    },
    [dispatch, notify, tabsDispatch],
  );

  const renameEntry = useCallback(
    async (entry: FileEntry, newName: string): Promise<void> => {
      if (!window.nova) {
        notify('error', 'Filesystem access is unavailable outside NOVA IDE');
        return;
      }
      const trimmed = newName.trim();
      const parent = pathParent(entry.path);
      dispatch({ type: 'cancel-input' });
      if (trimmed === '' || trimmed === entry.name) {
        return; // no-op rename — nothing to do
      }
      const result = await window.nova.fs.rename(entry.path, trimmed);
      if (!result.ok) {
        notify('error', result.message);
        return;
      }
      const newPath = result.value.path;

      // Keep open editor tabs (and their Monaco models) on the new path.
      const separator = entry.path.includes('\\') ? '\\' : '/';
      const folderPrefix =
        entry.path.endsWith('\\') || entry.path.endsWith('/')
          ? entry.path
          : entry.path + separator;
      let anyTabAffected = false;
      for (const tab of tabsState.tabs) {
        if (tab.filePath === null) {
          continue;
        }
        const affected =
          tab.filePath === entry.path ||
          (entry.kind === 'directory' && tab.filePath.startsWith(folderPrefix));
        if (!affected) {
          continue;
        }
        anyTabAffected = true;
        const suffix = tab.filePath.slice(entry.path.length);
        renameModelKey(tab.id, newPath + suffix);
      }
      if (anyTabAffected) {
        // Bulk action — one dispatch rewrites every affected tab.
        tabsDispatch({
          type: 'rename-file',
          path: entry.path,
          newPath,
          isDirectory: entry.kind === 'directory',
        });
      }
      if (entry.kind === 'directory') {
        // Child rows of the renamed folder are stale → drop them.
        dispatch({
          type: 'path-renamed',
          path: entry.path,
          newPath,
          isDirectory: true,
        });
      } else {
        dispatch({
          type: 'path-renamed',
          path: entry.path,
          newPath,
          isDirectory: false,
        });
      }
      // The PARENT's cached listing still holds the old name in both cases
      // (a file row changed; a folder row changed) — reload it so the tree
      // reflects the rename immediately instead of on the next refresh.
      dispatch({ type: 'reload', path: parent });
      dispatch({ type: 'select', path: newPath });
    },
    [dispatch, notify, tabsDispatch, tabsState.tabs],
  );

  const deleteEntry = useCallback(
    async (entry: FileEntry): Promise<void> => {
      if (!window.nova) {
        notify('error', 'Filesystem access is unavailable outside NOVA IDE');
        return;
      }
      const isDirectory = entry.kind === 'directory';
      const dirtyTabs = tabsState.tabs.filter(
        (tab) =>
          tab.isDirty &&
          tab.filePath !== null &&
          (tab.filePath === entry.path ||
            (isDirectory && tab.filePath.startsWith(entry.path + '\\')) ||
            (isDirectory && tab.filePath.startsWith(entry.path + '/'))),
      );
      const openCount = tabsState.tabs.filter(
        (tab) =>
          tab.filePath !== null &&
          (tab.filePath === entry.path ||
            (isDirectory && tab.filePath.startsWith(entry.path + '\\')) ||
            (isDirectory && tab.filePath.startsWith(entry.path + '/'))),
      ).length;

      const label = isDirectory ? 'folder' : 'file';
      let message = `Delete ${label} "${entry.name}"?`;
      if (isDirectory) {
        message += ' Its contents will be deleted too.';
      }
      if (openCount > 0) {
        message += `\n\n${openCount} open editor(s) will be closed${
          dirtyTabs.length > 0
            ? ` — ${dirtyTabs.length} with unsaved changes that will be lost`
            : ''
        }.`;
      }
      message += '\n\nThis cannot be undone.';
      if (!window.confirm(message)) {
        return;
      }

      const result = await window.nova.fs.delete(entry.path);
      if (!result.ok) {
        notify('error', result.message);
        return;
      }

      // Close affected tabs (models first, then tabs).
      for (const tab of tabsState.tabs) {
        if (tab.filePath === null) {
          continue;
        }
        const affected =
          tab.filePath === entry.path ||
          (isDirectory && tab.filePath.startsWith(entry.path + '\\')) ||
          (isDirectory && tab.filePath.startsWith(entry.path + '/'));
        if (affected) {
          disposeModel(tab.id);
        }
      }
      tabsDispatch({
        type: 'close-by-path',
        path: entry.path,
        isDirectory,
      });
      dispatch({ type: 'path-removed', path: entry.path, isDirectory });
      dispatch({ type: 'reload', path: pathParent(entry.path) });
      notify(
        'info',
        `Deleted ${label} "${entry.name}"`,
      );
    },
    [dispatch, notify, tabsDispatch, tabsState.tabs],
  );

  const saveActive = useCallback(async (): Promise<void> => {
    if (!window.nova) {
      notify('error', 'Filesystem access is unavailable outside NOVA IDE');
      return;
    }
    const tab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId);
    if (!tab) {
      return;
    }
    if (workspaceState.workspace === null && tab.filePath === null) {
      notify('error', 'Open a folder before saving files');
      return;
    }

    // Untitled buffer → native Save-As dialog (must stay in workspace).
    if (tab.filePath === null) {
      const result = await window.nova.fs.saveAs(null, tab.content);
      if (!result.ok) {
        notify('error', result.message);
        return;
      }
      if (result.value === null) {
        return; // cancelled
      }
      const name = pathBaseName(result.value.path);
      tabsDispatch({
        type: 'set-file-path',
        id: tab.id,
        filePath: result.value.path,
        name,
        language: detectLanguage(name),
        mtimeMs: result.value.mtimeMs,
      });
      return;
    }

    // File-backed: optimistic concurrency via expected mtime (spec §7.1).
    const filePath = tab.filePath;
    if (filePath === null) {
      return; // unreachable — handled above; keeps narrowing total
    }
    const content = tab.content;
    const expectedMtime = tab.mtimeMs;

    let result = await window.nova.fs.writeFile(
      filePath,
      content,
      expectedMtime,
    );
    if (!result.ok && result.code === 'CONFLICT') {
      const overwrite = window.confirm(
        `"${tab.name}" changed on disk since you opened it.\n\nOverwrite it with your version?`,
      );
      if (!overwrite) {
        return;
      }
      // Explicit user overwrite → force the write (mtime check skipped).
      result = await window.nova.fs.writeFile(filePath, content, null);
    }
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        const recreate = window.confirm(
          `"${tab.name}" no longer exists on disk.\n\nRecreate it with your changes?`,
        );
        if (!recreate) {
          return;
        }
        result = await window.nova.fs.writeFile(filePath, content, null);
        if (!result.ok) {
          notify('error', result.message);
          return;
        }
      } else {
        notify('error', result.message);
        return;
      }
    }
    tabsDispatch({ type: 'mark-saved', id: tab.id, mtimeMs: result.value.mtimeMs });
  }, [dispatch, notify, tabsDispatch, tabsState, workspaceState.workspace]);

  return { createEntry, renameEntry, deleteEntry, saveActive };
}
