/**
 * Search IPC handlers (spec §7, §19.2).
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { SearchService } from '../services/searchService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface SearchHandlers {
  query: Handler<'search:query'>;
  cancel: Handler<'search:cancel'>;
}

export function createSearchHandlers(search: SearchService): SearchHandlers {
  return {
    query: async (requestId, mode, pattern) =>
      search.query(requestId, mode, pattern),
    cancel: async (requestId) => search.cancel(requestId),
  };
}
