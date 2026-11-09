import { BrowserWindow, ipcMain } from 'electron';
import {
  IpcChannels,
  IpcPushChannels,
  type IpcInvokeMap,
} from '../../shared/ipc-types';
import { isAllowedChannel } from '../security/channels';
import { isTrustedSender } from '../security/sender';
import { FileSystemService } from '../services/fileSystemService';
import { OpenFileWatcher } from '../services/fileWatcher';
import { WorkspaceService } from '../services/workspaceService';
import { createAppInfoHandler } from './app-info';
import { createFileHandlers } from './files';
import { createWorkspaceHandlers } from './workspace';

/** Validates the argument list of a channel; throws on unexpected input. */
type ArgsValidator<C extends keyof IpcInvokeMap> = (
  args: unknown[],
) => asserts args is IpcInvokeMap[C]['args'];

function assertNoArgs(args: unknown[]): asserts args is [] {
  if (args.length !== 0) {
    throw new Error('This channel does not accept arguments');
  }
}

function assertOneString(args: unknown[]): asserts args is [string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a single string argument');
  }
}

function assertTwoStrings(args: unknown[]): asserts args is [string, string] {
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'string'
  ) {
    throw new Error('Expected two string arguments');
  }
}

function assertOptionalString(args: unknown[]): asserts args is [string?] {
  if (args.length > 1) {
    throw new Error('Expected at most one optional string argument');
  }
  if (args.length === 1 && args[0] !== undefined && typeof args[0] !== 'string') {
    throw new Error('Expected a string argument');
  }
}

function assertWriteFileArgs(
  args: unknown[],
): asserts args is [string, string, number | null] {
  if (args.length !== 3 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
    throw new Error('Expected (path, content, expectedMtimeMs)');
  }
  const expected = args[2];
  if (expected !== null && typeof expected !== 'number') {
    throw new Error('expectedMtimeMs must be a number or null');
  }
}

function assertSaveAsArgs(
  args: unknown[],
): asserts args is [string | null, string] {
  if (args.length !== 2 || typeof args[1] !== 'string') {
    throw new Error('Expected (suggestedPath, content)');
  }
  const suggested = args[0];
  if (suggested !== null && typeof suggested !== 'string') {
    throw new Error('suggestedPath must be a string or null');
  }
}

function assertStringArray(args: unknown[]): asserts args is [string[]] {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw new Error('Expected a single array argument');
  }
  if (!args[0].every((item) => typeof item === 'string')) {
    throw new Error('Expected an array of strings');
  }
}

/**
 * Registers a single IPC handler with full validation (spec §19.2):
 *  - channel must be on the whitelist,
 *  - sender must be the application renderer,
 *  - arguments must match the channel's schema.
 */
function registerChannel<C extends keyof IpcInvokeMap & string>(
  channel: C,
  validateArgs: ArgsValidator<C>,
  handler: (...args: IpcInvokeMap[C]['args']) => Promise<IpcInvokeMap[C]['result']>,
): void {
  if (!isAllowedChannel(channel)) {
    // Defensive: prevents registering handlers outside the whitelist.
    throw new Error(`Refusing to register non-whitelisted IPC channel: ${channel}`);
  }

  ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
    if (!isTrustedSender(event)) {
      throw new Error(`Rejected IPC message on "${channel}" from untrusted sender`);
    }
    validateArgs(rawArgs);
    return handler(...(rawArgs as IpcInvokeMap[C]['args']));
  });
}

/** Registers every validated IPC handler. Call once during app startup. */
export function registerIpcHandlers(): void {
  const watcher = new OpenFileWatcher((change) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcPushChannels.fsExternalChange, change);
    }
  });
  const workspaceService = new WorkspaceService();
  const fileService = new FileSystemService(
    () => workspaceService.getActiveRoot(),
    watcher,
  );

  const workspaceHandlers = createWorkspaceHandlers(workspaceService, watcher);
  const fileHandlers = createFileHandlers(fileService);

  registerChannel(IpcChannels.appGetInfo, assertNoArgs, createAppInfoHandler());

  // Workspace
  registerChannel(
    IpcChannels.workspaceOpen,
    assertOptionalString,
    workspaceHandlers.open,
  );
  registerChannel(
    IpcChannels.workspaceClose,
    assertNoArgs,
    workspaceHandlers.close,
  );
  registerChannel(
    IpcChannels.workspaceRecent,
    assertNoArgs,
    workspaceHandlers.recent,
  );

  // Filesystem
  registerChannel(IpcChannels.fsReadDir, assertOneString, fileHandlers.readDir);
  registerChannel(IpcChannels.fsReadFile, assertOneString, fileHandlers.readFile);
  registerChannel(
    IpcChannels.fsWriteFile,
    assertWriteFileArgs,
    fileHandlers.writeFile,
  );
  registerChannel(IpcChannels.fsSaveAs, assertSaveAsArgs, fileHandlers.saveAs);
  registerChannel(
    IpcChannels.fsCreateFile,
    assertOneString,
    fileHandlers.createFile,
  );
  registerChannel(
    IpcChannels.fsCreateFolder,
    assertOneString,
    fileHandlers.createFolder,
  );
  registerChannel(IpcChannels.fsRename, assertTwoStrings, fileHandlers.rename);
  registerChannel(IpcChannels.fsDelete, assertOneString, fileHandlers.delete);
  registerChannel(
    IpcChannels.fsSyncOpenFiles,
    assertStringArray,
    fileHandlers.syncOpenFiles,
  );
}
