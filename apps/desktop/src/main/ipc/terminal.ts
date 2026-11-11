/**
 * Terminal IPC handlers (spec §6.1, §17, §19.2).
 *
 * The renderer only receives the narrow `NovaTerminalApi`; every argument is
 * validated here before it reaches the terminal service.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { TerminalService } from '../services/terminalService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface TerminalHandlers {
  create: Handler<'terminal:create'>;
  write: Handler<'terminal:write'>;
  resize: Handler<'terminal:resize'>;
  kill: Handler<'terminal:kill'>;
}

export function createTerminalHandlers(
  terminal: TerminalService,
): TerminalHandlers {
  return {
    create: async (cwd) => terminal.create(cwd),
    write: async (sessionId, data) => terminal.write(sessionId, data),
    resize: async (sessionId, cols, rows) =>
      terminal.resize(sessionId, cols, rows),
    kill: async (sessionId) => terminal.kill(sessionId),
  };
}
