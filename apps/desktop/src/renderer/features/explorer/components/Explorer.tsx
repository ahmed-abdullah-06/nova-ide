import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { FileEntry, FileKind } from '../../../../shared/ipc-types';
import { COMMAND_IDS, createCommandDefinitions } from '../../../commands/catalog';
import { describeKeybindings } from '../../../commands/keybindings';
import type { Platform } from '../../../commands/types';
import { useConfirm } from '../../../components/ui/ConfirmProvider';
import { useTabs } from '../../../stores/tabs';
import { useWorkspace } from '../../../stores/workspace';
import { Icon } from '../../../components/ui/icons';
import { detectLanguage } from '../../../utils/language';
import { isVisibleExpanded, pathParent } from '../../../utils/path';
import { useWorkspaceActions } from '../../workspace/hooks/useWorkspaceActions';
import { useFileOperations } from '../../workspace/hooks/useFileOperations';
import { disposeModel } from '../../editor/modelRegistry';
import {
  ExplorerContextMenu,
  type ExplorerMenuState,
} from './ExplorerContextMenu';
import { FileTreeNode } from './FileTreeNode';
import { FileIcon } from '../fileIcons';

interface ExplorerProps {
  /** Bumped by Ctrl+Shift+E; focuses the tree when greater than zero. */
  focusSignal: number;
  /** Bumped by New File (Ctrl+N); starts inline creation at the root. */
  createFileSignal: number;
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return 'win32';
  }
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('mac')) {
    return 'darwin';
  }
  if (agent.includes('linux')) {
    return 'linux';
  }
  return 'win32';
}

/**
 * File explorer sidebar (spec §7).
 *
 * - opens/closes workspaces (native dialog via the main process),
 * - lazily loads only the visible, expanded directories,
 * - opens text files in the existing Monaco tabs (reusing open tabs),
 * - shows structured filesystem errors as notifications.
 */
export function Explorer({ focusSignal, createFileSignal }: ExplorerProps): ReactNode {
  const { state, dispatch } = useWorkspace();
  const actions = useWorkspaceActions();
  const fileOps = useFileOperations();
  const { confirm } = useConfirm();
  const tabs = useTabs();
  const treeRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef<Set<string>>(new Set());
  const [menu, setMenu] = useState<ExplorerMenuState | null>(null);
  const [openEditorsExpanded, setOpenEditorsExpanded] = useState(true);

  // A stale menu must not survive a workspace switch.
  useEffect(() => {
    setMenu(null);
  }, [state.workspace?.rootPath]);

  // Ctrl+Shift+E moves focus into the tree.
  useEffect(() => {
    if (focusSignal > 0) {
      treeRef.current?.focus();
    }
  }, [focusSignal]);

  // New File (Ctrl+N) reuses this inline-create flow at the workspace root.
  // A ref guard prevents a re-run when expanding the root changes state.
  const lastCreateSignal = useRef(0);
  useEffect(() => {
    if (createFileSignal === 0 || createFileSignal === lastCreateSignal.current) {
      return;
    }
    lastCreateSignal.current = createFileSignal;
    const workspace = state.workspace;
    if (!workspace) {
      return;
    }
    if (!state.expandedPaths.includes(workspace.rootPath)) {
      dispatch({ type: 'expand', path: workspace.rootPath });
    }
    dispatch({
      type: 'start-input',
      input: {
        kind: 'create-file',
        parentPath: workspace.rootPath,
        targetPath: null,
      },
    });
  }, [createFileSignal, dispatch, state.expandedPaths, state.workspace]);

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
      const confirmed = await confirm(
        `Close the workspace?\n\n` +
          `You have unsaved changes in ${dirty.length} file(s) that will be lost:\n` +
          `${shown}${more}`,
        {
          title: 'Unsaved changes',
          confirmLabel: 'Discard and close',
          destructive: true,
        },
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
  }, [actions, confirm, tabs]);

  /** Right-click: select the entry and open the actions menu next to it. */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent, entry: FileEntry): void => {
      actions.select(entry.path);
      setMenu({ x: event.clientX, y: event.clientY, entry });
    },
    [actions],
  );

  /** Starts the inline "New …" input inside the entry's target folder. */
  const beginCreate = useCallback(
    (entry: FileEntry, kind: FileKind): void => {
      const parentPath =
        entry.kind === 'directory' ? entry.path : pathParent(entry.path);
      // The input lives inside the folder's children, so make sure the
      // folder is expanded (and therefore lazily loaded) first.
      if (!state.expandedPaths.includes(parentPath)) {
        dispatch({ type: 'expand', path: parentPath });
      }
      dispatch({
        type: 'start-input',
        input: { kind: kind === 'directory' ? 'create-folder' : 'create-file', parentPath, targetPath: null },
      });
    },
    [dispatch, state.expandedPaths],
  );

  const beginRename = useCallback(
    (entry: FileEntry): void => {
      dispatch({
        type: 'start-input',
        input: {
          kind: 'rename',
          parentPath: pathParent(entry.path),
          targetPath: entry.path,
        },
      });
    },
    [dispatch],
  );

  const handleCreateSubmit = useCallback(
    (parentPath: string, kind: FileKind, name: string): void => {
      void fileOps.createEntry(parentPath, kind, name);
    },
    [fileOps],
  );

  const handleRenameSubmit = useCallback(
    (entry: FileEntry, name: string): void => {
      void fileOps.renameEntry(entry, name);
    },
    [fileOps],
  );

  const handleCancelInput = useCallback((): void => {
    dispatch({ type: 'cancel-input' });
  }, [dispatch]);

  const workspace = state.workspace;
  const platform = useMemo(detectPlatform, []);
  const shortcutHint = useMemo(() => {
    const command = createCommandDefinitions().find((entry) => entry.id === COMMAND_IDS.openWorkspace);
    const spec = command?.keybindings?.[platform] ?? command?.keybindings?.win32 ?? command?.keybindings?.linux;
    return describeKeybindings(spec, platform) ?? '';
  }, [platform]);

  return (
    <div className="explorer">
      <div className="sidebar__section explorer__header">
        <span className="explorer__title">
          <Icon name="chevronUp" size={12} className="explorer__title-chevron" />
          EXPLORER
        </span>
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

      <section className="explorer-section open-editors">
        <button
          type="button"
          className="explorer-section__header"
          aria-expanded={openEditorsExpanded}
          onClick={() => setOpenEditorsExpanded((value) => !value)}
        >
          <Icon
            name="chevronUp"
            size={12}
            className={`explorer-section__chevron${
              openEditorsExpanded ? '' : ' explorer-section__chevron--closed'
            }`}
          />
          <span>OPEN EDITORS</span>
          {tabs.state.tabs.length > 0 ? (
            <span className="explorer-section__count">
              {tabs.state.tabs.length}
            </span>
          ) : null}
        </button>
        {openEditorsExpanded ? (
          <div className="explorer-section__body">
            {tabs.state.tabs.length === 0 ? (
              <div className="explorer-section__hint">No open editors</div>
            ) : (
              tabs.state.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`open-editors__item${
                    tab.id === tabs.state.activeTabId
                      ? ' open-editors__item--active'
                      : ''
                  }`}
                  title={tab.filePath ?? tab.name}
                  onClick={() => tabs.dispatch({ type: 'activate', id: tab.id })}
                >
                  {tab.kind === 'settings' ? (
                    <Icon name="settings" size={14} className="open-editors__icon" />
                  ) : (
                    <FileIcon name={tab.name} kind="file" expanded={false} />
                  )}
                  <span>{tab.name}</span>
                  {tab.isDirty ? (
                    <span className="open-editors__dirty" aria-label="Unsaved" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </section>

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
            onCreateSubmit={handleCreateSubmit}
            onRenameSubmit={handleRenameSubmit}
            onCancelInput={handleCancelInput}
          />
        </div>
      )}

      {menu !== null && workspace !== null ? (
        <ExplorerContextMenu
          menu={menu}
          isRoot={menu.entry.path === workspace.rootPath}
          onClose={() => setMenu(null)}
          onNewFile={() => beginCreate(menu.entry, 'file')}
          onNewFolder={() => beginCreate(menu.entry, 'directory')}
          onRename={() => beginRename(menu.entry)}
          onDelete={() => void fileOps.deleteEntry(menu.entry)}
        />
      ) : null}
    </div>
  );
}
