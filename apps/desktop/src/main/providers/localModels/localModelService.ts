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
import { randomBytes } from 'node:crypto';
import type {
  AiResult,
  ProviderErrorInfo,
} from '../../../shared/ai-types';
import {
  MAX_LISTED_MODELS,
  type HardwareFacts,
  type LocalDownloadProgress,
  type LocalModelCatalog,
  type LocalModelDetails,
  type LocalModelEntry,
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
  parsePullStatus,
  parseRunningModels,
} from './catalog';
import {
  describeFit,
  estimateFit,
  LARGE_MODEL_BYTES,
  readHardwareFacts,
} from './hardware';
import { validateModelName } from './modelNames';

/** The maximum number of bytes of an answer that is read. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The minimum time between two progress updates (milliseconds). */
export const PROGRESS_THROTTLE_MS = 250;
/** The number of large models that may be loaded at the same time. */
export const MAX_CONCURRENT_LOADED_MODELS = 1;

/** The settings of the Ollama provider. */
export interface LocalModelTarget {
  baseUrl: string;
  remoteConfirmed: boolean;
}

/** One running download. */
interface RunningDownload {
  downloadId: string;
  model: string;
  controller: AbortController;
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
  /** Called for every progress update of a download. */
  onProgress?: (progress: LocalDownloadProgress) => void;
  /** Overrides `fetch` (the tests use it to talk to a mock server). */
  fetchImpl?: typeof fetch;
}

export class LocalModelService {
  private readonly options: LocalModelServiceOptions;
  /** The downloads that are running (at most one). */
  private readonly downloads = new Map<string, RunningDownload>();

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
    const hardware = await readHardwareFacts();
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

    // Only one large model may be loaded at the same time (spec §2.1).
    const largeLoaded = runningModels.filter(
      (entry) => (entry.sizeBytes ?? 0) > LARGE_MODEL_BYTES,
    );

    return {
      ok: true,
      value: {
        installed: visible.map((entry) => this.withFit(entry, hardware)),
        running: runningModels.map((entry) => this.withFit(entry, hardware)),
        hardware,
        service: { available: true },
        tooManyLoaded: largeLoaded.length > MAX_CONCURRENT_LOADED_MODELS,
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
    const hardware = await readHardwareFacts();
    const sizeBytes = summary?.sizeBytes;
    const fit = estimateFit(sizeBytes, hardware);

    return {
      ok: true,
      value: {
        id: model,
        name: model,
        sizeBytes,
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
        fit,
        fitNote: describeFit(fit, sizeBytes, hardware),
      },
    };
  }

  /**
   * Starts the download of a model.
   *
   * The download only starts when the user confirmed it explicitly:
   * the transfer comes from the registry of Ollama and reaches out
   * into the internet. Only one download runs at the same time.
   *
   * A download that was interrupted is safe to repeat: Ollama verifies
   * the layers it already has and only fetches what is missing, so the
   * second attempt continues where the first one stopped.
   */
  async pull(
    model: string,
    confirmed: boolean,
  ): Promise<AiResult<{ downloadId: string }>> {
    const problem = validateModelName(model);
    if (problem !== null) {
      return { ok: false, error: { code: 'unknown', message: problem } };
    }
    if (confirmed !== true) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message:
            'The download was not confirmed. The model is fetched from ' +
            'the registry of Ollama over the internet.',
        },
      };
    }
    if (this.downloads.size > 0) {
      return {
        ok: false,
        error: {
          code: 'busy',
          message:
            'A download is already running. Wait for it to finish or ' +
            'stop it first.',
        },
      };
    }
    const target = await this.options.target();
    const guard = this.checkTarget(target);
    if (guard !== null) {
      return { ok: false, error: guard };
    }

    const downloadId = `pull-${randomBytes(8).toString('hex')}`;
    const controller = new AbortController();
    this.downloads.set(downloadId, { downloadId, model, controller });

    // The download runs in the background: the panel follows it through
    // the progress channel.
    void this.runPull(downloadId, model, target, controller.signal);

    return { ok: true, value: { downloadId } };
  }

  /**
   * Stops a running download.
   *
   * The underlying HTTP stream is aborted, so the transfer really
   * stops. A download that does not exist cannot be cancelled.
   */
  cancelPull(downloadId: string): AiResult<void> {
    const download = this.downloads.get(downloadId);
    if (download === undefined) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The download is no longer running.',
        },
      };
    }
    download.controller.abort();
    return { ok: true, value: undefined };
  }

  /** Stops every running download (the application quits). */
  cancelAll(): void {
    for (const download of this.downloads.values()) {
      download.controller.abort();
    }
  }

  /**
   * Runs the download of a model and reports the progress.
   *
   * The stream of Ollama is read line by line. The updates are
   * throttled, so a fast download does not flood the renderer.
   */
  private async runPull(
    downloadId: string,
    model: string,
    target: LocalModelTarget,
    signal: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    let lastEmit = 0;
    let lastCompleted = 0;
    let lastTime = started;
    let speed: number | undefined;

    const emit = (progress: LocalDownloadProgress): void => {
      this.options.onProgress?.(progress);
    };

    const finish = (
      state: LocalDownloadProgress['state'],
      message: string,
      errorCode?: string,
    ): void => {
      this.downloads.delete(downloadId);
      emit({
        downloadId,
        model,
        state,
        message,
        done: true,
        errorCode,
      });
    };

    emit({
      downloadId,
      model,
      state: 'starting',
      message: 'The download is starting…',
      done: false,
    });

    const response: OllamaResult = await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'POST',
      endpoint: '/api/pull',
      body: JSON.stringify({ model, stream: true }),
      signal,
      // A download can take a long time — the timeout is generous.
      timeoutMs: 6 * 60 * 60 * 1000,
      fetchImpl: this.options.fetchImpl,
    });

    if (!response.ok) {
      if (response.error.code === 'cancelled') {
        finish('cancelled', 'The download was cancelled.');
        return;
      }
      finish('error', response.error.message, response.error.code);
      return;
    }

    const body = response.value.body;
    if (body === null) {
      finish(
        'error',
        'Ollama returned an answer without a body.',
        'invalid-response',
      );
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // A stopped download ends the stream at once, even when no status
    // line arrives any more.
    const onAbort = (): void => {
      void reader.cancel();
    };
    signal.addEventListener('abort', onAbort);

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const status = parsePullStatus(line);
          newline = buffer.indexOf('\n');
          if (status === null) {
            continue;
          }
          if (status.error !== undefined) {
            finish('error', status.error, 'unknown-model');
            await reader.cancel();
            return;
          }
          const now = Date.now();
          const completed = status.completed ?? lastCompleted;
          if (
            status.completed !== undefined &&
            now - lastTime > 0 &&
            status.completed > lastCompleted
          ) {
            const instant =
              ((status.completed - lastCompleted) / (now - lastTime)) * 1000;
            // The speed is smoothed, so the number does not jump.
            speed = speed === undefined ? instant : speed * 0.6 + instant * 0.4;
            lastCompleted = status.completed;
            lastTime = now;
          }
          const total = status.total;
          const percent =
            total !== undefined && total > 0 && completed !== undefined
              ? Math.min(100, Math.round((completed / total) * 100))
              : undefined;
          const state: LocalDownloadProgress['state'] =
            status.status !== undefined &&
            status.status.toLowerCase().includes('verifying')
              ? 'verifying'
              : 'downloading';
          // The updates are throttled: the panel must stay responsive.
          if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
            lastEmit = now;
            emit({
              downloadId,
              model,
              state,
              message: status.status ?? 'Downloading…',
              completedBytes: completed,
              totalBytes: total,
              percent,
              bytesPerSecond: speed,
              done: false,
            });
          }
        }
      }
    } catch {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        finish('cancelled', 'The download was cancelled.');
        return;
      }
      finish(
        'error',
        'The connection to Ollama failed while the model was downloaded.',
        'network',
      );
      return;
    }
    signal.removeEventListener('abort', onAbort);

    if (signal.aborted) {
      finish('cancelled', 'The download was cancelled.');
      return;
    }

    finish('success', 'The model was downloaded.');
  }

  /**
   * Deletes an installed model.
   *
   * A model that a running chat or agent run uses cannot be deleted:
   * the run would break in the middle. The user stops the run first.
   */
  async delete(model: string): Promise<AiResult<void>> {
    const problem = validateModelName(model);
    if (problem !== null) {
      return { ok: false, error: { code: 'unknown', message: problem } };
    }
    if (this.isInUse(model)) {
      return {
        ok: false,
        error: {
          code: 'in-use',
          message:
            `"${model}" is used by a running request. Stop the request ` +
            'before you delete the model.',
        },
      };
    }
    const target = await this.options.target();
    const guard = this.checkTarget(target);
    if (guard !== null) {
      return { ok: false, error: guard };
    }
    const response = await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'DELETE',
      endpoint: '/api/delete',
      body: JSON.stringify({ model }),
      timeoutMs: 60_000,
      fetchImpl: this.options.fetchImpl,
    });
    if (!response.ok) {
      return { ok: false, error: this.mapError(response, model) };
    }
    return { ok: true, value: undefined };
  }

  /**
   * Unloads a model from the memory.
   *
   * The file of the model stays on the disk; only the copy in the
   * memory is released (Ollama unloads a model with `keep_alive: 0`).
   */
  async unload(model: string): Promise<AiResult<void>> {
    const problem = validateModelName(model);
    if (problem !== null) {
      return { ok: false, error: { code: 'unknown', message: problem } };
    }
    if (this.isInUse(model)) {
      return {
        ok: false,
        error: {
          code: 'in-use',
          message:
            `"${model}" is used by a running request. Stop the request ` +
            'before you unload the model.',
        },
      };
    }
    const target = await this.options.target();
    const guard = this.checkTarget(target);
    if (guard !== null) {
      return { ok: false, error: guard };
    }
    await this.unloadModel(target, model);
    return { ok: true, value: undefined };
  }

  /** True when a running request uses the model. */
  private isInUse(model: string): boolean {
    const active = this.options.getActiveModels?.() ?? [];
    return active.includes(model);
  }

  /**
   * Makes sure that only one large model is loaded (spec §2.1).
   *
   * The method is called before a local request loads a model. A large
   * model that is loaded and not used by a running request is unloaded
   * first, so the machine never holds two of them at the same time.
   * A failure is ignored: the request must never be blocked by it.
   */
  async ensureSingleLoadedModel(model: string): Promise<void> {
    try {
      const target = await this.options.target();
      const guard = this.checkTarget(target);
      if (guard !== null) {
        return;
      }
      const running = await this.readRunning(target);
      if (!running.ok) {
        return;
      }
      const active = this.options.getActiveModels?.() ?? [];
      const large = running.value.filter(
        (entry) => (entry.sizeBytes ?? 0) > LARGE_MODEL_BYTES,
      );
      if (large.length <= MAX_CONCURRENT_LOADED_MODELS) {
        return;
      }
      let remaining = large.length;
      for (const entry of large) {
        if (remaining <= MAX_CONCURRENT_LOADED_MODELS) {
          break;
        }
        if (entry.id === model || active.includes(entry.id)) {
          continue;
        }
        await this.unloadModel(target, entry.id);
        remaining -= 1;
      }
    } catch {
      // The advice must never break a request.
    }
  }

  /**
   * Unloads a model from the memory.
   *
   * The file of the model stays on the disk; only the copy in the
   * memory is released (Ollama unloads a model with `keep_alive: 0`).
   */
  private async unloadModel(
    target: LocalModelTarget,
    model: string,
  ): Promise<void> {
    await ollamaRequest({
      baseUrl: target.baseUrl,
      remoteConfirmed: target.remoteConfirmed,
      method: 'POST',
      endpoint: '/api/generate',
      body: JSON.stringify({ model, keep_alive: 0 }),
      timeoutMs: 60_000,
      fetchImpl: this.options.fetchImpl,
    });
  }

  /** Adds the fit of a model to its entry. */
  private withFit(
    entry: LocalModelEntryDraft,
    hardware: HardwareFacts,
  ): LocalModelEntry {
    const fit = estimateFit(entry.sizeBytes, hardware);
    return {
      ...entry,
      fit,
      fitNote: describeFit(fit, entry.sizeBytes, hardware),
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
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer that could not be read.',
        },
      };
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
    if (
      detail !== undefined &&
      /no space|not enough space|disk/i.test(detail)
    ) {
      return {
        code: 'no-space',
        message:
          'There is not enough space on the disk for the model. ' +
          'Free some space and try again.',
      };
    }
    return response.error;
  }
}
