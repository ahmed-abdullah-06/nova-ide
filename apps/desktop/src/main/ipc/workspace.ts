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
}

export function createWorkspaceHandlers(
  workspace: WorkspaceService,
  watcher: OpenFileWatcher,
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
    },
    recent: async () => workspace.recent(),
  };
}
