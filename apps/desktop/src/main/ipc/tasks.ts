/**
 * Task runner IPC handlers (spec §21, §19.2).
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { TaskService } from '../services/taskService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface TaskHandlers {
  list: Handler<'task:list'>;
  run: Handler<'task:run'>;
  cancel: Handler<'task:cancel'>;
}

export function createTaskHandlers(tasks: TaskService): TaskHandlers {
  return {
    list: async () => tasks.list(),
    run: async (name) => tasks.run(name),
    cancel: async (taskId) => tasks.cancel(taskId),
  };
}
