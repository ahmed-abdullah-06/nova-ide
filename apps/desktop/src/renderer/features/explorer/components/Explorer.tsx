import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { FileEntry } from '../../../../shared/ipc-types';
import { useTabs } from '../../../stores/tabs';
import { useWorkspace } from '../../../stores/workspace';
import { detectLanguage } from '../../../utils/language';
import { isVisibleExpanded } from '../../../utils/path';
import { useWorkspaceActions } from '../../workspace/hooks/useWorkspaceActions';
import { disposeModel } from '../../editor/modelRegistry';
import { FileTreeNode } from './FileTreeNode';

interface ExplorerProps {
  /** Bumped by Ctrl+Shift+E; focuses the tree when greater than zero. */
  focusSignal: number;
}

function isMacPlatform(): boolean {
  return navigator.userAgent.toLowerCase().includes('mac');
}

/**
 * File explorer sidebar (spec §7).
 *
 * - opens/closes workspaces (native dialog via the main process),
 * - lazily loads only the visible, expanded directories,
 * - opens text files in the existing Monaco tabs (reusing open tabs),
 * - shows structured filesystem errors as notifications.
 */
export function Explorer({ focusSignal }: ExplorerProps): ReactNode {
  const { state, dispatch } = useWorkspace();
  const actions = useWorkspaceActions();
  const tabs = useTabs();
  const treeRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef<Set<string>>(new Set());

  // Ctrl+Shift+E moves focus into the tree.
  useEffect(() => {
    if (focusSignal > 0) {
      treeRef.current?.focus();
    }
  }, [focusSignal]);

  // Recent workspaces are read once when the explorer mounts.
  useEffect(() => {
    void actions.loadRecent();
  }, [actions.loadRecent]);

  // Lazy directory loading: every VISIBLE expanded folder is read at most
  // once. `refresh` / `retry` clear entries from the cache, which
  // re-triggers this effect; collapsed-but-remembered folders stay cached
  // and are not re-read.
  useEffect(() => {
    if (state.status !== 'ready' || !window.nova) {
      return;
    }
    const rootPath = state.workspace?.rootPath;
    if (!rootPath) {
      return;
    }
    const expanded = new Set(state.expandedPaths);
    for (const path of state.expandedPaths) {
      if (!isVisibleExpanded(path, expanded, rootPath)) {
        continue;
      }
      if (state.directories[path] !== undefined) {
        continue; // loaded, loading, or awaiting a manual retry
      }
      if (loadingRef.current.has(path)) {
        continue; // request already in flight (StrictMode double-effects)
      }
      loadingRef.current.add(path);
      dispatch({ type: 'load-start', path });
      window.nova.fs
        .readDirectory(path)
        .then((result) => {
          if (result.ok) {
            dispatch({
              type: 'load-success',
              path,
              entries: result.value.entries,
              truncated: result.value.truncated,
            });
          } else {
            dispatch({ type: 'load-failure', path, message: result.message });
          }
        })
        .catch(() => {
          dispatch({
            type: 'load-failure',
            path,
            message: 'Cannot read folder',
          });
        })
        .finally(() => {
          loadingRef.current.delete(path);
        });
    }
  }, [
    state.status,
    state.workspace,
    state.expandedPaths,
    state.directories,
    dispatch,
  ]);

  /** Opens a text file in the existing editor (reusing its tab). */
  const openFile = useCallback(
    async (entry: FileEntry): Promise<void> => {
      if (!window.nova) {
        return;
      }

      // Already open → activate the existing tab. Unsaved changes are never
      // overwritten by a re-read from disk.
      const existing = tabs.state.tabs.find(
        (tab) => tab.filePath === entry.path,
      );
      if (existing) {
        tabs.dispatch({ type: 'activate', id: existing.id });
        return;
      }

      const result = await window.nova.fs.readFile(entry.path);
      if (!result.ok) {
        dispatch({ type: 'notify', kind: 'error', message: result.message });
        return;
      }

      tabs.dispatch({
        type: 'open',
        id: result.value.path,
        name: entry.name,
        language: detectLanguage(entry.name),
        content: result.value.content,
        filePath: result.value.path,
        mtimeMs: result.value.mtimeMs,
      });
    },
    [dispatch, tabs],
  );

  /** Close Folder: confirms when unsaved workspace files would be lost. */
  const handleCloseWorkspace = useCallback(async (): Promise<void> => {
    const dirty = tabs.state.tabs.filter(
      (tab) => tab.filePath !== null && tab.isDirty,
    );
    if (dirty.length > 0) {
      const shown = dirty
        .slice(0, 5)
        .map((tab) => tab.name)
        .join(', ');
      const more = dirty.length > 5 ? ` and ${dirty.length - 5} more` : '';
      const confirmed = window.confirm(
        `Close the workspace?\n\n` +
          `You have unsaved changes in ${dirty.length} file(s) that will be lost:\n` +
          `${shown}${more}`,
      );
      if (!confirmed) {
        return;
      }
    }

    // Workspace-specific editor buffers are cleared; untitled scratch
    // buffers and unrelated settings are preserved.
    for (const tab of tabs.state.tabs) {
      if (tab.filePath !== null) {
        disposeModel(tab.id);
        tabs.dispatch({ type: 'close', id: tab.id });
      }
    }
    await actions.closeWorkspace();
  }, [actions, tabs]);

  const handleContextMenu = useCallback(
    (_event: ReactMouseEvent, _entry: FileEntry): void => {
      // Context-menu actions (new/rename/delete) arrive with the file
      // operations phase; suppress the browser menu meanwhile.
    },
    [],
  );

  const workspace = state.workspace;
  const shortcutHint = isMacPlatform() ? '⌘⇧O' : 'Ctrl+Shift+O';

  return (
    <div className="explorer">
      <div className="sidebar__section explorer__header">
        <span className="explorer__title">EXPLORER</span>
        {workspace !== null ? (
          <div className="explorer__actions">
            <button
              type="button"
              className="icon-button"
              title="Refresh Explorer"
              aria-label="Refresh Explorer"
              onClick={actions.refresh}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 11a8 8 0 1 0-.6 4" />
                <path d="M20 5v6h-6" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-button"
              title="Close Folder"
              aria-label="Close Folder"
              onClick={() => void handleCloseWorkspace()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {state.status === 'opening' ? (
        <div className="explorer__status" role="status">
          Opening folder…
        </div>
      ) : null}

      {workspace === null ? (
        <div className="explorer__empty">
          <span className="explorer__empty-title">No Folder Open</span>
          <button
            type="button"
            className="explorer__open-button"
            onClick={() => void actions.openFolder()}
          >
            Open Folder…
          </button>
          <span className="explorer__empty-hint">{shortcutHint}</span>

          {state.recent.length > 0 ? (
            <div className="explorer__recent">
              <span className="explorer__recent-title">RECENT</span>
              {state.recent.map((item) => (
                <button
                  key={item.rootPath}
                  type="button"
                  className="explorer__recent-item"
                  title={item.rootPath}
                  onClick={() => void actions.openRecent(item.rootPath)}
                >
                  <span className="explorer__recent-dot" aria-hidden="true" />
                  <span className="explorer__recent-name">{item.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="explorer__tree"
          role="tree"
          aria-label={`${workspace.name} file tree`}
          ref={treeRef}
          tabIndex={-1}
        >
          <FileTreeNode
            entry={{
              name: workspace.name,
              path: workspace.rootPath,
              kind: 'directory',
            }}
            depth={0}
            state={state}
            onToggle={actions.toggleDirectory}
            onSelect={actions.select}
            onOpenFile={(entry) => void openFile(entry)}
            onRetry={actions.retryDirectory}
            onContextMenu={handleContextMenu}
          />
        </div>
      )}
    </div>
  );
}
