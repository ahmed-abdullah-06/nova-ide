/**
 * The management of the local models (spec §11.3, §2.1, §21).
 *
 * The service talks to the local Ollama service and offers the panel
 * what it needs to know:
 *
 *  - which models are installed and which of them are loaded,
 *  - what Ollama reports about a model (its capabilities, its size).
 *
 * Everything happens in the main process: the renderer only sends the
 * *name* of a model and never a URL, a path or a command. The address
 * comes from the settings of the provider and must point at this
 * machine, unless the user confirmed it explicitly (spec §19.2).
 *
 * The agent has no access to this service: a model can never download,
 * delete or unload anything by itself (spec §10.4).
 */
import type {
  AiResult,
  ProviderErrorInfo,
} from '../../../shared/ai-types';
import {
  MAX_LISTED_MODELS,
  type LocalModelCatalog,
  type LocalModelDetails,
  type LocalModelEntryDraft,
} from '../../../shared/local-model-types';
import {
  ollamaRequest,
  readJsonBody,
  type OllamaResult,
} from '../ollama/http';
import { isLoopbackUrl } from '../urlPolicy';
import {
  parseInstalledModels,
  parseModelDetails,
  parseRunningModels,
} from './catalog';
import { validateModelName } from './modelNames';

/** The maximum number of bytes of an answer that is read. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The number of large models that may be loaded at the same time. */
export const MAX_CONCURRENT_LOADED_MODELS = 1;

/** The settings of the Ollama provider. */
export interface LocalModelTarget {
  baseUrl: string;
  remoteConfirmed: boolean;
}

export interface LocalModelServiceOptions {
  /**
   * The address of the Ollama service and whether the user confirmed
   * an address outside of this machine.
   */
  target: () => Promise<LocalModelTarget>;
  /**
   * The models that are used by a running chat or agent run.
   *
   * A model that is in use cannot be deleted or unloaded.
   */
  getActiveModels?: () => string[];
  /** Overrides `fetch` (the tests use it to talk to a mock server). */
  fetchImpl?: typeof fetch;
}

export class LocalModelService {
  private readonly options: LocalModelServiceOptions;

  constructor(options: LocalModelServiceOptions) {
    this.options = options;
  }

  /**
   * The catalog of the local models.
   *
   * The list is built from the answers of Ollama. A service that does
   * not answer produces an error with an honest message — never a fake
   * model.
   */
  async catalog(): Promise<AiResult<LocalModelCatalog>> {
    const target = await this.options.target();

    const installed = await this.readInstalled(target);
    if (!installed.ok) {
      return {
        ok: false,
        error: installed.error,
      };
    }

    const running = await this.readRunning(target);
    const runningModels = running.ok ? running.value : [];

    const loadedIds = new Set(runningModels.map((entry) => entry.id));
    const entries: LocalModelEntryDraft[] = installed.value.map((entry) => ({
      ...entry,
      loaded: loadedIds.has(entry.id),
    }));

    const truncated = entries.length > MAX_LISTED_MODELS;
    const visible = entries.slice(0, MAX_LISTED_MODELS);

    return {
      ok: true,
      value: {
        installed: visible,
        running: runningModels,
        service: { available: true },
        tooManyLoaded: false,
        maxConcurrentLoaded: MAX_CONCURRENT_LOADED_MODELS,
        truncated,
      },
    };
  }

  /**
   * The details of one model.
   *
   * The capabilities come from Ollama itself. When Ollama does not
   * report them, the panel says "unknown" — the application never
   * guesses that a model can call tools.
   */
  async details(model: string): Promise<AiResult<LocalModelDetails>> {
    const problem = validateModelName(model);
    if (problem !== null) {
      return { ok: false, error: { code: 'unknown', message: problem } };
    }
    const target = await this.options.target();
    const guard = this.checkTarget(target);
    if (guard !== null) {
      return { ok: false, error: guard };
    }

    const response = await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'POST',
      endpoint: '/api/show',
      body: JSON.stringify({ model }),
      timeoutMs: 30_000,
      fetchImpl: this.options.fetchImpl,
    });
    if (!response.ok) {
      return { ok: false, error: this.mapError(response, model) };
    }
    const payload = await readJsonBody(response.value, MAX_RESPONSE_BYTES);
    if (payload === null) {
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer that could not be read.',
        },
      };
    }

    const parsed = parseModelDetails(payload);
    const installed = await this.readInstalled(target);
    const summary =
      installed.ok
        ? installed.value.find((entry) => entry.id === model)
        : undefined;

    return {
      ok: true,
      value: {
        id: model,
        name: model,
        sizeBytes: summary?.sizeBytes,
        parameterSize: parsed.parameterSize ?? summary?.parameterSize,
        quantization: parsed.quantization ?? summary?.quantization,
        family: parsed.family ?? summary?.family,
        modifiedAt: parsed.modifiedAt ?? summary?.modifiedAt,
        license: parsed.license,
        parameters: parsed.parameters,
        capabilities: parsed.capabilities,
        capabilitiesKnown: parsed.capabilitiesKnown,
        supportsToolCalls: parsed.supportsToolCalls,
        supportsVision: parsed.supportsVision,
        supportsThinking: parsed.supportsThinking,
        contextLength: parsed.contextLength,
      },
    };
  }

  /**
   * Refuses an address that is not on this machine.
   *
   * The same confirmation as the chat needs: otherwise the "LOCAL"
   * badge would be a lie.
   */
  private checkTarget(target: LocalModelTarget): ProviderErrorInfo | null {
    if (!target.remoteConfirmed && !isLoopbackUrl(target.baseUrl)) {
      return {
        code: 'not-running',
        message:
          'The address of Ollama is not on this machine. Confirm it in the ' +
          'provider settings before models can be managed.',
      };
    }
    return null;
  }

  /** Reads the installed models. */
  private async readInstalled(
    target: LocalModelTarget,
  ): Promise<AiResult<LocalModelEntryDraft[]>> {
    const response = await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'GET',
      endpoint: '/api/tags',
      timeoutMs: 30_000,
      fetchImpl: this.options.fetchImpl,
    });
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    const payload = await readJsonBody(response.value, MAX_RESPONSE_BYTES);
    if (payload === null) {
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer that could not be read.',
        },
      };
    }
    return { ok: true, value: parseInstalledModels(payload) };
  }

  /** Reads the models that are loaded in the memory. */
  private async readRunning(
    target: LocalModelTarget,
  ): Promise<AiResult<LocalModelEntryDraft[]>> {
    const response = await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'GET',
      endpoint: '/api/ps',
      timeoutMs: 15_000,
      fetchImpl: this.options.fetchImpl,
    });
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    const payload = await readJsonBody(response.value, MAX_RESPONSE_BYTES);
    if (payload === null) {
      return { ok: false, error: { code: 'invalid-response', message: '' } };
    }
    return { ok: true, value: parseRunningModels(payload) };
  }

  /** Maps a failed answer of Ollama to a message for the user. */
  private mapError(
    response: Extract<OllamaResult, { ok: false }>,
    model: string,
  ): ProviderErrorInfo {
    if (response.status === 404) {
      return {
        code: 'model-not-found',
        message: `The model "${model}" was not found on the server.`,
      };
    }
    const detail = response.detail;
    if (detail !== undefined && detail.toLowerCase().includes('not found')) {
      return {
        code: 'model-not-found',
        message: `The model "${model}" was not found on the server.`,
      };
    }
    return response.error;
  }
}
