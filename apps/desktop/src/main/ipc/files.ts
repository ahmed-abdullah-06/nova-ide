/**
 * Filesystem IPC handlers (spec §7, §19.2, §19.3).
 * Every handler delegates to the workspace-scoped `FileSystemService`; the
 * channel whitelist, sender check, and argument validation live in
 * `ipc/index.ts`.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { FileSystemService } from '../services/fileSystemService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface FileHandlers {
  readDir: Handler<'fs:read-dir'>;
  readFile: Handler<'fs:read-file'>;
  writeFile: Handler<'fs:write-file'>;
  saveAs: Handler<'fs:save-as'>;
  createFile: Handler<'fs:create-file'>;
  createFolder: Handler<'fs:create-folder'>;
  rename: Handler<'fs:rename'>;
  delete: Handler<'fs:delete'>;
  syncOpenFiles: Handler<'fs:sync-open-files'>;
}

export function createFileHandlers(files: FileSystemService): FileHandlers {
  return {
    readDir: (pathValue) => files.readDirectory(pathValue),
    readFile: (pathValue) => files.readFile(pathValue),
    writeFile: (pathValue, content, expectedMtimeMs) =>
      files.writeFile(pathValue, content, expectedMtimeMs),
    saveAs: (suggestedPath, content) => files.saveAs(suggestedPath, content),
    createFile: (pathValue) => files.createFile(pathValue),
    createFolder: (pathValue) => files.createFolder(pathValue),
    rename: (pathValue, newName) => files.rename(pathValue, newName),
    delete: (pathValue) => files.delete(pathValue),
    syncOpenFiles: (paths) => files.syncOpenFiles(paths),
  };
}
