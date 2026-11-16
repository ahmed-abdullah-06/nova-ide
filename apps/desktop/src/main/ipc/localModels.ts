/**
 * The IPC handlers of the local model management (spec §11.3, §19.2).
 *
 * The handlers are thin: they delegate to the model service, which
 * validates the names and builds the requests in the main process.
 *
 * The renderer only ever sends the *name* of a model. It never sends
 * an address, a path or a command, and it can never start a download
 * that it did not confirm.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { LocalModelService } from '../providers/localModels/localModelService';
import type { ModelDefaultsStore } from '../providers/localModels/modelDefaultsStore';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface LocalModelHandlers {
  catalog: Handler<'ai:local-models'>;
  details: Handler<'ai:local-model-details'>;
  pull: Handler<'ai:local-model-pull'>;
  cancelPull: Handler<'ai:local-model-cancel-pull'>;
  delete: Handler<'ai:local-model-delete'>;
  unload: Handler<'ai:local-model-unload'>;
  defaults: Handler<'ai:local-model-defaults'>;
  setDefaults: Handler<'ai:local-model-defaults-set'>;
}

export function createLocalModelHandlers(
  models: LocalModelService,
  defaults: ModelDefaultsStore,
): LocalModelHandlers {
  return {
    catalog: async () => models.catalog(),
    details: async (model) => models.details(model),
    pull: async (model, confirmed) => models.pull(model, confirmed),
    cancelPull: async (downloadId) => models.cancelPull(downloadId),
    delete: async (model) => models.delete(model),
    unload: async (model) => models.unload(model),
    defaults: async () => defaults.get(),
    setDefaults: async (next) => defaults.set(next),
  };
}
