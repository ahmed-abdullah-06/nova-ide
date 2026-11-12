/**
 * The OpenAI compatible cloud provider (spec §11.4).
 *
 * It speaks the OpenAI chat completion API, so it covers OpenAI itself
 * and every service that offers the same interface (OpenRouter, Groq,
 * Together, a local gateway, …) — the address is configurable.
 *
 * The adapter is deliberately built on plain `fetch`: an SDK would add a
 * dependency (and a second update rhythm) for a request format that is
 * small and stable.
 *
 * Security:
 *  - the provider is disabled until the user configured a key,
 *  - the key only travels in the authorization header and never appears
 *    in an error message or a log,
 *  - the address of the service is validated before it is used.
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
import { normalizeBaseUrl, validateProviderUrl } from '../urlPolicy';

/** The default timeout of a cloud request (milliseconds). */
export const DEFAULT_CLOUD_TIMEOUT_MS = 120_000;
/** The maximum number of retries after a rate limit. */
export const DEFAULT_MAX_RETRIES = 2;
/** The longest wait after a rate limit (milliseconds). */
export const MAX_RETRY_AFTER_MS = 30_000;

export interface OpenAiCompatibleProviderOptions {
  /** The address of the service, for example `https://api.openai.com/v1`. */
  baseUrl: string;
  /**
   * The API key.
   *
   * It is held by the main process only and never leaves it.
   */
  apiKey?: string | null;
  /** The timeout of a single request. */
  timeoutMs?: number;
  /** The maximum number of retries after a rate limit. */
  maxRetries?: number;
  /** Overrides `fetch` (the tests use it to talk to a mock server). */
  fetchImpl?: typeof fetch;
}

/** One model of the service (`/models`). */
interface OpenAiModelList {
  data?: unknown;
}

export class OpenAiCompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible';
  readonly name = 'OpenAI compatible (cloud)';
  readonly kind = 'cloud' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey ?? null;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolCalls: false,
      vision: false,
      structuredOutput: false,
      systemPrompt: true,
      local: false,
    };
  }

  /** The models the service offers. */
  async listModels(): Promise<AiResult<ProviderModel[]>> {
    const response = await this.send('GET', '/models');
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
          message: 'The provider returned an answer that could not be read.',
        },
      };
    }
    const data = (payload as OpenAiModelList).data;
    if (!Array.isArray(data)) {
      return {
        ok: false,
        error: {
          code: 'invalid-response',
          message: 'The provider returned an unexpected answer.',
        },
      };
    }
    const models: ProviderModel[] = [];
    for (const entry of data) {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string') {
        models.push({ id, name: id });
      }
    }
    return { ok: true, value: models };
  }

  /** Checks whether the service accepts the key. */
  async checkConnection(): Promise<ProviderStatus> {
    const started = Date.now();
    if (this.apiKey === null || this.apiKey.length === 0) {
      return {
        available: false,
        reason: 'unauthorized',
        message: 'No API key is configured for this provider.',
      };
    }
    const response = await this.send('GET', '/models');
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
   * Streams the answer of the cloud model.
   *
   * The request is aborted when the signal fires — the underlying fetch
   * is cancelled, so the service stops generating.
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
    if (request.options.temperature !== undefined) {
      body.temperature = request.options.temperature;
    }
    if (request.options.maxTokens !== undefined) {
      body.max_tokens = request.options.maxTokens;
    }

    const response = await this.send('POST', '/chat/completions', {
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
          message: 'The provider returned an answer without a body.',
        },
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

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
            const event = parseStreamLine(line);
            if (event.type === 'error') {
              yield event;
              return;
            }
            yield event;
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
              ? `The connection to the provider failed: ${error.message}`
              : 'The connection to the provider failed.',
        },
      };
      return;
    }

    if (request.signal.aborted) {
      yield { type: 'finish', reason: 'cancelled' };
      return;
    }
    yield { type: 'finish', reason: 'stop' };
  }

  /**
   * Performs a request against the service.
   *
   * A rate limit is retried a bounded number of times; the wait is the
   * time the service asked for (capped).
   */
  private async send(
    method: 'GET' | 'POST',
    endpoint: string,
    options: { body?: string; request?: ProviderChatRequest } = {},
  ): Promise<
    | { ok: true; value: Response }
    | { ok: false; error: ProviderErrorInfo }
  > {
    const urlError = validateProviderUrl(this.baseUrl);
    if (urlError !== null) {
      return { ok: false, error: { code: 'unknown', message: urlError } };
    }
    if (this.apiKey === null || this.apiKey.length === 0) {
      return {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'No API key is configured for this provider.',
        },
      };
    }

    let attempt = 0;
    for (;;) {
      const response = await this.request(
        method,
        endpoint,
        options,
      );
      if (response.ok) {
        return response;
      }
      // Only a rate limit is retried.
      if (response.error.code !== 'rate-limited' || attempt >= this.maxRetries) {
        return response;
      }
      const wait = Math.min(
        response.error.retryAfterMs ?? 1000,
        MAX_RETRY_AFTER_MS,
      );
      attempt += 1;
      await delay(wait, options.request?.signal);
    }
  }

  /** Performs one request. */
  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    options: { body?: string; request?: ProviderChatRequest },
  ): Promise<
    | { ok: true; value: Response }
    | { ok: false; error: ProviderErrorInfo }
  > {
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
        headers: {
          authorization: `Bearer ${this.apiKey ?? ''}`,
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body: options.body,
        signal: controller.signal,
      });

      if (response.ok) {
        return { ok: true, value: response };
      }
      return { ok: false, error: await describeFailure(response) };
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
            message: 'The request to the provider timed out.',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'network',
          message:
            'The provider could not be reached. ' +
            'Check the address and the network connection.',
        },
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Describes a failed answer of the service.
 *
 * The detail of the service is shortened and never contains a key.
 */
async function describeFailure(response: Response): Promise<ProviderErrorInfo> {
  const detail = await readDetail(response);

  if (response.status === 401 || response.status === 403) {
    return {
      code: 'unauthorized',
      message:
        'The provider rejected the API key. ' +
        'Check the key in the provider settings.',
    };
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(
      response.headers.get('retry-after') ?? '',
      10,
    );
    return {
      code: 'rate-limited',
      message:
        'The provider is rate limiting the requests. ' +
        'Please try again in a moment.',
      retryAfterMs:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000,
    };
  }
  if (response.status === 404) {
    return {
      code: 'model-not-found',
      message: detail || 'The provider does not know this model.',
    };
  }
  if (response.status === 400) {
    return {
      code: 'model-not-found',
      message: detail || 'The provider rejected the request.',
    };
  }
  return {
    code: 'unknown',
    message: detail || `The provider answered with the status ${response.status}.`,
  };
}

/** Reads the (short) detail of a failed answer. */
async function readDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length === 0) {
      return '';
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string') {
        return redact(error.slice(0, 200));
      }
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === 'string') {
        return redact(message.slice(0, 200));
      }
    } catch {
      // Not JSON.
    }
    return redact(text.slice(0, 200));
  } catch {
    return '';
  }
}

/**
 * Parses one line of the server sent events of the provider.
 *
 * The lines look like `data: {"choices":[{"delta":{"content":"Hi"}}]}`;
 * the stream ends with `data: [DONE]`.
 */
export function parseStreamLine(line: string): AIStreamEvent {
  if (!line.startsWith('data:')) {
    // A comment or an event of another type — ignored.
    return { type: 'text', delta: '' };
  }
  const payload = line.slice('data:'.length).trim();
  if (payload.length === 0) {
    return { type: 'text', delta: '' };
  }
  if (payload === '[DONE]') {
    return { type: 'finish', reason: 'stop' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {
      type: 'error',
      error: {
        code: 'invalid-response',
        message: 'The provider returned an answer that could not be read.',
      },
    };
  }

  const chunk = parsed as {
    choices?: {
      delta?: { content?: unknown };
      finish_reason?: unknown;
    }[];
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
    error?: unknown;
  };

  if (typeof chunk.error === 'string' && chunk.error.length > 0) {
    return {
      type: 'error',
      error: { code: 'unknown', message: redact(chunk.error.slice(0, 200)) },
    };
  }

  const usage = chunk.usage;
  if (usage !== undefined && usage !== null) {
    const promptTokens =
      typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
    const completionTokens =
      typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : undefined;
    const totalTokens =
      typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined;
    return {
      type: 'usage',
      usage: { promptTokens, completionTokens, totalTokens },
    };
  }

  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content.length > 0) {
    return { type: 'text', delta: content };
  }
  return { type: 'text', delta: '' };
}

/** Waits for the given time (the wait is cut short by an abort). */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort);
  });
}
