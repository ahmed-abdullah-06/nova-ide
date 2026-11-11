/**
 * Git IPC handlers (spec §16, §19.2).
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { GitService } from '../services/gitService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface GitHandlers {
  status: Handler<'git:status'>;
  stage: Handler<'git:stage'>;
  unstage: Handler<'git:unstage'>;
  discard: Handler<'git:discard'>;
  commit: Handler<'git:commit'>;
  diff: Handler<'git:diff'>;
  branches: Handler<'git:branches'>;
  switchBranch: Handler<'git:switch-branch'>;
}

export function createGitHandlers(git: GitService): GitHandlers {
  return {
    status: async () => git.status(),
    stage: async (path) => git.stage(path),
    unstage: async (path) => git.unstage(path),
    discard: async (path) => git.discard(path),
    commit: async (message) => git.commit(message),
    diff: async (path, staged) => git.diff(path, staged),
    branches: async () => git.branches(),
    switchBranch: async (name) => git.switchBranch(name),
  };
}
