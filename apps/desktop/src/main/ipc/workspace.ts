/**
 * Workspace IPC handlers (spec §7, §19.2).
 * Wires the workspace service and the open-file watcher into the validated
 * `registerChannel` pipeline of `ipc/index.ts`.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { OpenFileWatcher } from '../services/fileWatcher';
import type { WorkspaceService } from '../services/workspaceService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface WorkspaceHandlers {
  open: Handler<'workspace:open'>;
  close: Handler<'workspace:close'>;
  recent: Handler<'workspace:recent'>;
  active: Handler<'workspace:active'>;
}

/**
 * Callbacks invoked when the workspace is closed, so that every child
 * process (terminal sessions, running tasks) is terminated (spec §19.6).
 */
export interface WorkspaceCloseHooks {
  /** Called after the workspace has been closed. */
  onClose?: () => void;
}

export function createWorkspaceHandlers(
  workspace: WorkspaceService,
  watcher: OpenFileWatcher,
  hooks: WorkspaceCloseHooks = {},
): WorkspaceHandlers {
  return {
    open: async (pathValue?: string) => {
      const previousRoot = workspace.getActiveRoot();
      const result = await workspace.open(pathValue);
      // Switching to a different root invalidates the old watch set; the
      // renderer re-syncs with its (new) open files right after.
      if (
        result.ok &&
        result.value !== null &&
        result.value.rootPath !== previousRoot
      ) {
        watcher.clear();
      }
      return result;
    },
    close: async () => {
      workspace.close();
      watcher.clear();
      hooks.onClose?.();
    },
    recent: async () => workspace.recent(),
    active: async () => workspace.getActiveWorkspace(),
  };
}
