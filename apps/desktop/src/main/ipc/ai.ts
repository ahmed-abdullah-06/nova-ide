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
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { ChatService } from '../providers/chatService';
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
}

export function createAiHandlers(
  providers: ProviderService,
  chat: ChatService,
  credentials: CredentialStore,
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
  };
}
