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
import { createTerminalHandlers } from './terminal';
import { createSearchHandlers } from './search';
import { createGitHandlers } from './git';
import {
  assertNoArgs,
  assertOneString,
  assertOptionalCwd,
  assertOptionalString,
  assertSaveAsArgs,
  assertPathAndBoolean,
  assertSearchQuery,
  assertSessionAndData,
  assertSessionAndSize,
  assertStringArray,
  assertTwoStrings,
  assertWriteFileArgs,
  type ArgsValidator,
} from './validators';
import { TerminalService } from '../services/terminalService';
import { SearchService } from '../services/searchService';
import { GitService } from '../services/gitService';

/** Channels that take exactly one string argument. */
const assertOneStringArg = assertOneString;

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
export function registerIpcHandlers(): () => void {
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

  const fileHandlers = createFileHandlers(fileService);

  const terminalService = new TerminalService({
    getRoot: () => workspaceService.getActiveRoot(),
    onData: (sessionId, data) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.terminalData, {
          sessionId,
          data,
        });
      }
    },
    onExit: (exit) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.terminalExit, exit);
      }
    },
  });
  const terminalHandlers = createTerminalHandlers(terminalService);

  const searchService = new SearchService({
    getRoot: () => workspaceService.getActiveRoot(),
    onResults: (results) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.searchResults, results);
      }
    },
  });
  const searchHandlers = createSearchHandlers(searchService);

  const gitService = new GitService({
    getRoot: () => workspaceService.getActiveRoot(),
  });
  const gitHandlers = createGitHandlers(gitService);




  const workspaceHandlers = createWorkspaceHandlers(workspaceService, watcher, {
    onClose: () => {
      // Closing the workspace terminates every child process it owns
      // (spec §19.6 "Terminate running processes").
      void terminalService.killAll();
    },
  });

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
  registerChannel(
    IpcChannels.workspaceActive,
    assertNoArgs,
    workspaceHandlers.active,
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

  // Terminal
  registerChannel(
    IpcChannels.terminalCreate,
    assertOptionalCwd,
    terminalHandlers.create,
  );
  registerChannel(
    IpcChannels.terminalWrite,
    assertSessionAndData,
    terminalHandlers.write,
  );
  registerChannel(
    IpcChannels.terminalResize,
    assertSessionAndSize,
    terminalHandlers.resize,
  );
  registerChannel(
    IpcChannels.terminalKill,
    assertOneStringArg,
    terminalHandlers.kill,
  );

  // Search
  registerChannel(
    IpcChannels.searchQuery,
    assertSearchQuery,
    searchHandlers.query,
  );
  registerChannel(
    IpcChannels.searchCancel,
    assertOneStringArg,
    searchHandlers.cancel,
  );

  // Git
  registerChannel(IpcChannels.gitStatus, assertNoArgs, gitHandlers.status);
  registerChannel(
    IpcChannels.gitStage,
    assertOneStringArg,
    gitHandlers.stage,
  );
  registerChannel(
    IpcChannels.gitUnstage,
    assertOneStringArg,
    gitHandlers.unstage,
  );
  registerChannel(
    IpcChannels.gitDiscard,
    assertOneStringArg,
    gitHandlers.discard,
  );
  registerChannel(
    IpcChannels.gitCommit,
    assertOneStringArg,
    gitHandlers.commit,
  );
  registerChannel(
    IpcChannels.gitDiff,
    assertPathAndBoolean,
    gitHandlers.diff,
  );




  /**
   * Terminates every child process the application owns.
   *
   * Called when the app quits, so no terminal shell or task survives the
   * main process (spec §19.6 "Terminate running processes").
   */
  return () => {
    void terminalService.killAll();
    watcher.clear();
  };
}
