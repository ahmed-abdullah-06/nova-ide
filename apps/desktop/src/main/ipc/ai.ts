/**
 * AI IPC handlers (spec §11, §19.2).
 *
 * The handlers are thin: they validate the arguments (in the shared
 * validator of the channel) and delegate to the provider layer.
 *
 * The API key travels through exactly one channel — from the renderer
 * (where the user typed it) to the main process (which encrypts it). It
 * is never returned.
 */
import { dialog } from 'electron';
import path from 'node:path';
import type { FsResult, IpcInvokeMap } from '../../shared/ipc-types';
import type { ChatService } from '../providers/chatService';
import type { ConversationStore } from '../providers/conversationStore';
import type { CredentialStore } from '../providers/credentials';
import type { ProviderService } from '../providers/providerService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface AiHandlers {
  providers: Handler<'ai:providers'>;
  models: Handler<'ai:models'>;
  status: Handler<'ai:status'>;
  chat: Handler<'ai:chat'>;
  cancel: Handler<'ai:cancel'>;
  setKey: Handler<'ai:set-key'>;
  clearKey: Handler<'ai:clear-key'>;
  conversations: Handler<'ai:conversations'>;
  saveConversation: Handler<'ai:conversation-save'>;
  deleteConversation: Handler<'ai:conversation-delete'>;
  updateProvider: Handler<'ai:provider-update'>;
  removeProvider: Handler<'ai:provider-remove'>;
  pickFiles: Handler<'ai:pick-files'>;
  previewContext: Handler<'ai:context-preview'>;
}

export function createAiHandlers(
  providers: ProviderService,
  chat: ChatService,
  credentials: CredentialStore,
  conversations: ConversationStore,
): AiHandlers {
  return {
    providers: async () => providers.descriptors(),
    models: async (providerId) => providers.models(providerId),
    status: async (providerId) => providers.status(providerId),
    chat: async (
      requestId,
      providerId,
      model,
      messages,
      attachments,
      approveCloudContext,
    ) =>
      chat.start(
        requestId,
        providerId,
        model,
        messages,
        attachments,
        approveCloudContext,
      ),
    cancel: async (requestId) => chat.cancel(requestId),
    setKey: async (providerId, key) => credentials.setKey(providerId, key),
    clearKey: async (providerId) => credentials.clearKey(providerId),
    conversations: async () => conversations.list(),
    saveConversation: async (conversation) => conversations.save(conversation),
    deleteConversation: async (id) => {
      await conversations.remove(id);
    },
    updateProvider: async (providerId, settings) =>
      providers.update(providerId, settings),
    removeProvider: async (providerId) => providers.remove(providerId),
    pickFiles: async () => pickContextFiles(chat),
    previewContext: async (attachments) => ({
      ok: true,
      value: await chat.preview(attachments),
    }),
  };
}

/**
 * Lets the user pick the files that are attached as context.
 *
 * The dialog is restricted to the workspace, so a file outside of it can
 * never be attached.
 */
async function pickContextFiles(chat: ChatService): Promise<FsResult<string[]>> {
  const root = chat.workspaceRoot();
  if (root === null) {
    return {
      ok: false,
      code: 'NO_WORKSPACE',
      message: 'Open a folder before attaching files.',
    };
  }
  try {
    const result = await dialog.showOpenDialog({
      title: 'Attach files as context',
      defaultPath: root,
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, value: [] };
    }
    const paths: string[] = [];
    for (const filePath of result.filePaths) {
      // Only files inside the workspace may be attached.
      const relative = path.relative(root, filePath);
      if (relative.length === 0 || relative.startsWith('..')) {
        continue;
      }
      paths.push(filePath);
    }
    return { ok: true, value: paths };
  } catch (error) {
    console.error(
      '[ai] the files could not be picked:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      ok: false,
      code: 'UNKNOWN',
      message: 'The files could not be picked.',
    };
  }
}
