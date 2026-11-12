/**
 * The Ollama provider (spec §11.3).
 *
 * Talks to the local Ollama HTTP API:
 *  - `GET /api/tags` lists the installed models,
 *  - `POST /api/chat` streams the answer as newline delimited JSON.
 *
 * Nothing ever leaves the machine: the provider is local, and its URL
 * must point at the loopback interface unless the user explicitly
 * confirmed a remote address.
 *
 * No default model is assumed — only the models that are really
 * installed are offered (spec §2).
 */
import type {
  AIStreamEvent,
  AiResult,
  ProviderCapabilities,
  ProviderErrorInfo,
  ProviderModel,
  ProviderStatus,
} from '../../../shared/ai-types';
import type {
  AIProvider,
  ProviderChatRequest,
} from '../interfaces/provider';
import { redact } from '../redact';
import {
  DEFAULT_OLLAMA_URL,
  isLoopbackUrl,
  normalizeBaseUrl,
} from '../urlPolicy';

/** The default timeout of a request to the local model (milliseconds). */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;

export interface OllamaProviderOptions {
  /** The address of the Ollama service. */
  baseUrl?: string;
  /** The timeout of a single request. */
  timeoutMs?: number;
  /** True when the user confirmed an address outside the local machine. */
  remoteConfirmed?: boolean;
  /** Overrides `fetch` (the tests use it to talk to a mock server). */
  fetchImpl?: typeof fetch;
}

/** One model of the Ollama service (`/api/tags`). */
interface OllamaTag {
  name?: unknown;
  model?: unknown;
  size?: unknown;
  details?: {
    family?: unknown;
    parameter_size?: unknown;
  };
}

/** One chunk of the answer (`/api/chat`). */
interface OllamaChatChunk {
  message?: {
    content?: unknown;
    tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[];
  };
  done?: unknown;
  error?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (local)';
  readonly kind = 'local' as const;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly remoteConfirmed: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OLLAMA_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    this.remoteConfirmed = options.remoteConfirmed ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      // Not every local model supports tool calls equally well, so the
      // capability is checked per model (spec 11.3).
      toolCalls: false,
      vision: false,
      structuredOutput: false,
      systemPrompt: true,
      local: true,
    };
  }

  /** The models that are really installed on this machine. */
  async listModels(): Promise<AiResult<ProviderModel[]>> {
    const response = await this.request('GET', '/api/tags');
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    let payload: unknown;
    try {
      payload = await response.value.json();
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer that could not be read.',
        },
      };
    }
    const tags = (payload as { models?: unknown }).models;
    if (!Array.isArray(tags)) {
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an unexpected answer.',
        },
      };
    }

    const models: ProviderModel[] = [];
    for (const entry of tags as OllamaTag[]) {
      const id = typeof entry.name === 'string' ? entry.name : undefined;
      if (id === undefined) {
        continue;
      }
      const size = typeof entry.size === 'number' ? entry.size : undefined;
      const family =
        typeof entry.details?.family === 'string' ? entry.details.family : undefined;
      const parameterSize =
        typeof entry.details?.parameter_size === 'string'
          ? entry.details.parameter_size
          : undefined;
      models.push({
        id,
        name: id,
        sizeBytes: size,
        family,
        parameterSize,
        // Tool calls depend on the model, so they are not claimed here.
        supportsToolCalls: false,
      });
    }
    return { ok: true, value: models };
  }

  /** Checks whether the local service answers. */
  async checkConnection(): Promise<ProviderStatus> {
    const started = Date.now();
    const response = await this.request('GET', '/api/tags');
    const latencyMs = Date.now() - started;
    if (response.ok) {
      return { available: true, latencyMs };
    }
    return {
      available: false,
      reason: response.error.code,
      message: response.error.message,
      latencyMs,
    };
  }

  /**
   * Streams the answer of the local model.
   *
   * The request is aborted when the signal fires — the underlying fetch
   * is cancelled, so the model stops generating.
   */
  async *chat(request: ProviderChatRequest): AsyncIterable<AIStreamEvent> {
    const body: Record<string, unknown> = {
      model: request.options.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: true,
    };
    if (
      request.tools !== undefined &&
      request.tools.length > 0 &&
      this.getCapabilities().toolCalls
    ) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await this.request('POST', '/api/chat', {
      body: JSON.stringify(body),
      request,
    });
    if (!response.ok) {
      yield { type: 'error', error: response.error };
      return;
    }

    yield { type: 'start', model: request.options.model };

    const reader = response.value.body?.getReader();
    if (reader === undefined) {
      yield {
        type: 'error',
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer without a body.',
        },
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            const event = parseChatChunk(line);
            if (event.error !== undefined) {
              yield event.error;
              return;
            }
            if (event.usage !== undefined) {
              promptTokens = event.usage.promptTokens;
              completionTokens = event.usage.completionTokens;
            }
            if (event.toolCall !== undefined) {
              yield { type: 'toolCall', toolCall: event.toolCall };
            }
            if (event.text !== undefined && event.text.length > 0) {
              yield { type: 'text', delta: event.text };
            }
          }
          newline = buffer.indexOf('\n');
        }
      }
    } catch (error) {
      if (request.signal.aborted) {
        yield { type: 'finish', reason: 'cancelled' };
        return;
      }
      yield {
        type: 'error',
        error: {
          code: 'network',
          message:
            error instanceof Error
              ? `The connection to Ollama failed: ${error.message}`
              : 'The connection to Ollama failed.',
        },
      };
      return;
    }

    if (request.signal.aborted) {
      yield { type: 'finish', reason: 'cancelled' };
      return;
    }
    if (promptTokens !== undefined || completionTokens !== undefined) {
      yield {
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens:
            promptTokens !== undefined && completionTokens !== undefined
              ? promptTokens + completionTokens
              : undefined,
        },
      };
    }
    yield { type: 'finish', reason: 'stop' };
  }

  /**
   * Performs a request against the Ollama service.
   *
   * The errors are normalized: a refused connection means that the
   * service is not running, a missing endpoint means that it is not
   * installed at that address.
   */
  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    options: { body?: string; request?: ProviderChatRequest } = {},
  ): Promise<
    | { ok: true; value: Response }
    | { ok: false; error: ProviderErrorInfo }
  > {
    if (!this.remoteConfirmed && !isLoopbackUrl(this.baseUrl)) {
      return {
        ok: false,
        error: {
          code: 'not-running',
          message:
            'The address of Ollama is not on this machine. ' +
            'Confirm the address before it can be used.',
        },
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    const signal = options.request?.signal;
    const onAbort = (): void => {
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method,
        headers:
          options.body === undefined
            ? undefined
            : { 'content-type': 'application/json' },
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        if (response.status === 404) {
          return {
            ok: false,
            error: {
              code: 'not-installed',
              message:
                'Ollama does not seem to be installed at ' +
                `${this.baseUrl}. Start Ollama and try again.`,
            },
          };
        }
        if (response.status === 404 || detail.includes('not found')) {
          return {
            ok: false,
            error: {
              code: 'model-not-found',
              message: detail || 'The model was not found.',
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'unknown',
            message: detail || `Ollama answered with the status ${response.status}.`,
          },
        };
      }
      return { ok: true, value: response };
    } catch (error) {
      if (signal?.aborted === true) {
        return {
          ok: false,
          error: { code: 'cancelled', message: 'The request was cancelled.' },
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort')) {
        return {
          ok: false,
          error: {
            code: 'timeout',
            message: 'The request to Ollama timed out.',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'not-running',
          message:
            'Ollama does not seem to be running. ' +
            'Start the Ollama application and try again.',
        },
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** The parsed content of one chunk of the answer. */
interface ParsedChunk {
  text?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: AIStreamEvent & { type: 'error' };
  toolCall?: { name: string; arguments: unknown };
}
/** Parses one line of the answer of Ollama. */
function parseChatChunk(line: string): ParsedChunk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      error: {
        type: 'error',
        error: {
          code: 'invalid-response',
          message: 'Ollama returned an answer that could not be read.',
        },
      },
    };
  }

  const chunk = parsed as OllamaChatChunk;
  if (typeof chunk.error === 'string' && chunk.error.length > 0) {
    return {
      error: {
        type: 'error',
        error: {
          code: chunk.error.includes('not found')
            ? 'model-not-found'
            : 'unknown',
          message: chunk.error,
        },
      },
    };
  }

  const toolCalls = chunk.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const fn = toolCalls[0]?.function;
    let args: unknown = {};
    if (typeof fn?.arguments === 'object' && fn?.arguments !== null) {
      args = fn.arguments;
    } else if (typeof fn?.arguments === 'string' && fn.arguments.length > 0) {
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }
    }
    const name = typeof fn?.name === 'string' ? fn.name : '';
    if (name.length > 0) {
      return {
        text: undefined,
        usage: undefined,
        error: undefined,
        toolCall: { name, arguments: args },
      };
    }
  }

  const content = chunk.message?.content;
  const usage: ParsedChunk['usage'] = {};
  if (typeof chunk.prompt_eval_count === 'number') {
    usage.promptTokens = chunk.prompt_eval_count;
  }
  if (typeof chunk.eval_count === 'number') {
    usage.completionTokens = chunk.eval_count;
  }

  return {
    text: typeof content === 'string' ? content : undefined,
    usage: Object.keys(usage).length > 0 ? usage : undefined,
  };
}

/** Reads the error detail of a failed response (never a secret). */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length === 0) {
      return '';
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const message = (parsed as { error?: unknown }).error;
      if (typeof message === 'string') {
        return redact(message);
      }
    } catch {
      // Not JSON — the raw text is used (it is short and local).
    }
    return redact(text.slice(0, 200));
  } catch {
    return '';
  }
}
