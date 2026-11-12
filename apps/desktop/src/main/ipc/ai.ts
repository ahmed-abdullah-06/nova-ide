/**
 * AI IPC handlers (spec §11, §19.2).
 *
 * The handlers only read the provider layer; they never touch a key and
 * never perform a network request themselves.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { ProviderService } from '../providers/providerService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface AiHandlers {
  providers: Handler<'ai:providers'>;
  models: Handler<'ai:models'>;
  status: Handler<'ai:status'>;
}

export function createAiHandlers(providers: ProviderService): AiHandlers {
  return {
    providers: async () => providers.descriptors(),
    models: async (providerId) => providers.models(providerId),
    status: async (providerId) => providers.status(providerId),
  };
}
