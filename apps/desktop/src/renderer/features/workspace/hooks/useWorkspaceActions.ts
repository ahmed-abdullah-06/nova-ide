/**
 * Side-effectful workspace actions (spec §7, §9).
 *
 * The reducer stays pure; this hook is the only renderer place that talks
 * to `window.nova.workspace` — every call returns structured results that
 * are translated into reducer actions (errors become notifications).
 */
import { useCallback } from 'react';
import { useWorkspace } from '../../../stores/workspace';
import type { NotificationKind } from '../../../stores/workspaceReducer';

export interface WorkspaceActions {
  /** Opens the native folder dialog and activates the chosen folder. */
  openFolder(): Promise<void>;
  /** Opens a folder from the Recent Workspaces list. */
  openRecent(rootPath: string): Promise<void>;
  /** Closes the active workspace (editor/explorer state is reset by caller). */
  closeWorkspace(): Promise<void>;
  /** Reloads the recent workspaces list from disk. */
  loadRecent(): Promise<void>;
  /** Clears cached directory contents; expanded folders re-read lazily. */
  refresh(): void;
  toggleDirectory(path: string): void;
  select(path: string | null): void;
  retryDirectory(path: string): void;
  notify(kind: NotificationKind, message: string): void;
}

export function useWorkspaceActions(): WorkspaceActions {
  const { state, dispatch } = useWorkspace();

  const openWith = useCallback(
    async (pathValue?: string): Promise<void> => {
      if (!window.nova) {
        dispatch({
          type: 'notify',
          kind: 'error',
          message: 'Filesystem access is unavailable outside NOVA IDE',
        });
        return;
      }
      dispatch({ type: 'open-start' });
      try {
        const result = await window.nova.workspace.open(pathValue);
        if (!result.ok) {
          dispatch({ type: 'open-failed', message: result.message });
          return;
        }
        if (result.value === null) {
          dispatch({ type: 'open-cancelled' });
          return;
        }
        dispatch({ type: 'open-succeeded', workspace: result.value });
      } catch {
        dispatch({
          type: 'open-failed',
          message: 'Cannot open folder: unexpected error',
        });
      }
    },
    [dispatch],
  );

  const openFolder = useCallback(
    (): Promise<void> => openWith(),
    [openWith],
  );

  const openRecent = useCallback(
    (rootPath: string): Promise<void> => openWith(rootPath),
    [openWith],
  );

  const closeWorkspace = useCallback(async (): Promise<void> => {
    if (!window.nova) {
      return;
    }
    try {
      await window.nova.workspace.close();
    } finally {
      dispatch({ type: 'close' });
    }
  }, [dispatch]);

  const loadRecent = useCallback(async (): Promise<void> => {
    if (!window.nova) {
      return;
    }
    try {
      const recent = await window.nova.workspace.recent();
      dispatch({ type: 'recent-loaded', recent });
    } catch {
      // Recent history stays empty when it cannot be read.
    }
  }, [dispatch]);

  const refresh = useCallback((): void => {
    dispatch({ type: 'refresh' });
  }, [dispatch]);

  const toggleDirectory = useCallback(
    (path: string): void => {
      if (state.expandedPaths.includes(path)) {
        dispatch({ type: 'collapse', path });
      } else {
        dispatch({ type: 'expand', path });
      }
    },
    [dispatch, state.expandedPaths],
  );

  const select = useCallback(
    (path: string | null): void => {
      dispatch({ type: 'select', path });
    },
    [dispatch],
  );

  const retryDirectory = useCallback(
    (path: string): void => {
      dispatch({ type: 'reload', path });
      dispatch({ type: 'expand', path });
    },
    [dispatch],
  );

  const notify = useCallback(
    (kind: NotificationKind, message: string): void => {
      dispatch({ type: 'notify', kind, message });
    },
    [dispatch],
  );

  return {
    openFolder,
    openRecent,
    closeWorkspace,
    loadRecent,
    refresh,
    toggleDirectory,
    select,
    retryDirectory,
    notify,
  };
}
