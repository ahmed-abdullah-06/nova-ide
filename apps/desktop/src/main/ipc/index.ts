import { BrowserWindow, ipcMain, shell } from 'electron';
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
import { createTaskHandlers } from './tasks';
import { createAiHandlers } from './ai';
import { createAgentHandlers } from './agent';
import {
  assertNoArgs,
  assertOneString,
  assertOptionalCwd,
  assertAgentTask,
  assertApprovalAnswer,
  assertChatRequest,
  assertContextAttachments,
  assertConversation,
  assertConversationId,
  assertExternalUrl,
  assertOptionalString,
  assertProviderId,
  assertProposalId,
  assertProviderKey,
  assertProviderSettings,
  assertRequestId,
  assertRunId,
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
import { TaskService } from '../services/taskService';
import { ChildWatchdog } from '../services/childWatchdog';
import { ChatService } from '../providers/chatService';
import { ConversationStore } from '../providers/conversationStore';
import { CredentialStore } from '../providers/credentials';
import { ProviderService } from '../providers/providerService';
import { ProviderSettingsStore } from '../providers/settings';
import { AgentService } from '../agent/agentService';
import { ToolExecutor } from '../agent/toolExecutor';
import { DEFAULT_PERMISSION_SETTINGS } from '../agent/permissions';

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
/**
 * Registers every IPC handler.
 *
 * @returns A function that terminates every child process of the
 *   application. The promise resolves when the process trees are gone.
 */
export function registerIpcHandlers(): () => Promise<void> {
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

  // The watchdog terminates the children when the main process dies
  // unexpectedly (a crash skips every cleanup handler).
  const watchdog = new ChildWatchdog();
  watchdog.start();

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
    onProcessStart: (pid) => {
      watchdog.track(pid);
    },
    onProcessEnd: (pid) => {
      watchdog.untrack(pid);
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

  const taskService = new TaskService({
    getRoot: () => workspaceService.getActiveRoot(),
    onOutput: (output) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.taskOutput, output);
      }
    },
    onStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.taskStatus, status);
      }
    },
    onProcessStart: (pid) => {
      watchdog.track(pid);
    },
    onProcessEnd: (pid) => {
      watchdog.untrack(pid);
    },
  });
  const taskHandlers = createTaskHandlers(taskService);

  // The provider layer: the settings live in the main process, so the
  // renderer never sees a key. The providers are created from the
  // settings when they are used, so a changed address takes effect at
  // once.
  const providerSettings = new ProviderSettingsStore();
  const credentialStore = new CredentialStore(providerSettings);
  const providerService = new ProviderService(providerSettings, (providerId) =>
    credentialStore.getKey(providerId),
  );
  const chatService = new ChatService({
    providers: providerService,
    credentials: credentialStore,
    getRoot: () => workspaceService.getActiveRoot(),
    onEvent: (requestId, event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.aiStream, { requestId, event });
      }
    },
  });
  const conversationStore = new ConversationStore();

  // The coding agent (spec §9, §12). The agent shares the services of the
  // application: it reads through the file service, it searches with the
  // search service, it inspects the repository with the git service and it
  // runs commands through the task runner.
  const agentSearch = new SearchService({
    getRoot: () => workspaceService.getActiveRoot(),
    onResults: () => undefined,
  });
  const agentExecutor = new ToolExecutor({
    files: fileService,
    search: agentSearch,
    git: gitService,
    tasks: taskService,
  });
  const agentService = new AgentService({
    providers: providerService,
    credentials: credentialStore,
    files: fileService,
    executor: agentExecutor,
    getRoot: () => workspaceService.getActiveRoot(),
    permissions: DEFAULT_PERMISSION_SETTINGS,
    onEvent: (runId, event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.agentEvent, { runId, event });
      }
    },
    onState: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.agentStateChanged, state);
      }
    },
    onFileChanged: (path) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcPushChannels.fsExternalChange, {
          path,
          kind: 'changed',
          mtimeMs: null,
        });
      }
    },
  });
  const agentHandlers = createAgentHandlers(agentService);
  const aiHandlers = createAiHandlers(
    providerService,
    chatService,
    credentialStore,
    conversationStore,
  );




  const workspaceHandlers = createWorkspaceHandlers(workspaceService, watcher, {
    onClose: () => {
      // Closing the workspace terminates every child process it owns
      // (spec §19.6 "Terminate running processes").
      void stopChildProcesses();
    },
  });

  registerChannel(IpcChannels.appGetInfo, assertNoArgs, createAppInfoHandler());

  // A link of the chat is opened in the browser of the user — only http
  // and https are accepted (the output of a model is untrusted).
  registerChannel(
    IpcChannels.appOpenExternal,
    assertExternalUrl,
    async (url: string) => {
      try {
        await shell.openExternal(url);
      } catch (error) {
        console.error(
          '[app] the link could not be opened:',
          error instanceof Error ? error.message : 'unknown error',
        );
        return { ok: false, code: 'UNKNOWN', message: 'The link could not be opened.' };
      }
      return { ok: true, value: undefined };
    },
  );

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
  registerChannel(IpcChannels.gitBranches, assertNoArgs, gitHandlers.branches);
  registerChannel(
    IpcChannels.gitSwitchBranch,
    assertOneStringArg,
    gitHandlers.switchBranch,
  );

  // Tasks
  registerChannel(IpcChannels.taskList, assertNoArgs, taskHandlers.list);
  registerChannel(
    IpcChannels.taskRun,
    assertOneStringArg,
    taskHandlers.run,
  );
  registerChannel(
    IpcChannels.taskCancel,
    assertOneStringArg,
    taskHandlers.cancel,
  );

  // The coding agent
  registerChannel(
    IpcChannels.agentStart,
    assertAgentTask,
    agentHandlers.start,
  );
  registerChannel(
    IpcChannels.agentCancel,
    assertRunId,
    agentHandlers.cancel,
  );
  registerChannel(IpcChannels.agentState, assertNoArgs, agentHandlers.state);
  registerChannel(
    IpcChannels.agentApprove,
    assertApprovalAnswer,
    agentHandlers.approve,
  );
  registerChannel(
    IpcChannels.agentAcceptProposal,
    assertProposalId,
    agentHandlers.acceptProposal,
  );
  registerChannel(
    IpcChannels.agentRejectProposal,
    assertProposalId,
    agentHandlers.rejectProposal,
  );
  registerChannel(
    IpcChannels.agentAcceptAll,
    assertRunId,
    agentHandlers.acceptAll,
  );
  registerChannel(
    IpcChannels.agentRejectAll,
    assertRunId,
    agentHandlers.rejectAll,
  );
  registerChannel(
    IpcChannels.agentRevert,
    assertRunId,
    agentHandlers.revert,
  );
  registerChannel(IpcChannels.agentAudit, assertNoArgs, agentHandlers.audit);

  // AI providers
  registerChannel(IpcChannels.aiProviders, assertNoArgs, aiHandlers.providers);
  registerChannel(
    IpcChannels.aiModels,
    assertProviderId,
    aiHandlers.models,
  );
  registerChannel(
    IpcChannels.aiStatus,
    assertProviderId,
    aiHandlers.status,
  );
  registerChannel(
    IpcChannels.aiChat,
    assertChatRequest,
    aiHandlers.chat,
  );
  registerChannel(
    IpcChannels.aiCancel,
    assertRequestId,
    aiHandlers.cancel,
  );
  registerChannel(
    IpcChannels.aiSetKey,
    assertProviderKey,
    aiHandlers.setKey,
  );
  registerChannel(
    IpcChannels.aiClearKey,
    assertProviderId,
    aiHandlers.clearKey,
  );
  registerChannel(
    IpcChannels.aiConversations,
    assertNoArgs,
    aiHandlers.conversations,
  );
  registerChannel(
    IpcChannels.aiConversationSave,
    assertConversation,
    aiHandlers.saveConversation,
  );
  registerChannel(
    IpcChannels.aiConversationDelete,
    assertConversationId,
    aiHandlers.deleteConversation,
  );
  registerChannel(
    IpcChannels.aiProviderUpdate,
    assertProviderSettings,
    aiHandlers.updateProvider,
  );
  registerChannel(
    IpcChannels.aiProviderRemove,
    assertProviderId,
    aiHandlers.removeProvider,
  );
  registerChannel(
    IpcChannels.aiPickFiles,
    assertNoArgs,
    aiHandlers.pickFiles,
  );
  registerChannel(
    IpcChannels.aiContextPreview,
    assertContextAttachments,
    aiHandlers.previewContext,
  );




  /**
   * Terminates every child process the application owns.
   *
   * Called when the app quits, so no terminal shell or task survives the
   * main process (spec §19.6 "Terminate running processes").
   *
   * The promise resolves when the process trees are really gone, so the
   * application can wait for it before it quits — otherwise a task could
   * outlive the application.
   */
  const stopChildProcesses = async (): Promise<void> => {
    // The running requests are aborted, so the providers stop generating.
    chatService.cancelAll();
    agentService.cancelAll();
    await Promise.all([terminalService.killAll(), taskService.killAll()]);
    watchdog.stop();
    watcher.clear();
  };

  return stopChildProcesses;
}
