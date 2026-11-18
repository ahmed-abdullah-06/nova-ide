/**
 * IPC handlers for the native Open File dialog and external-file grants.
 *
 * `open` takes no arguments at all; `read`/`write` take only an opaque grant
 * id (plus content). The renderer never supplies a path, so it cannot widen a
 * grant or bypass `pathSecurity`.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { ExternalFileService } from '../services/externalFileService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface ExternalFileHandlers {
  open: Handler<'fs:open-file'>;
  read: Handler<'fs:read-external'>;
  write: Handler<'fs:write-external'>;
}

export function createExternalFileHandlers(
  service: ExternalFileService,
): ExternalFileHandlers {
  return {
    open: () => service.open(),
    read: (grantId) => service.read(grantId),
    write: (grantId, content, expectedMtimeMs) =>
      service.write(grantId, content, expectedMtimeMs),
  };
}
