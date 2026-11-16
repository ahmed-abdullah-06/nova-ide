/**
 * The HTTP access to the local Ollama service (spec §11.3).
 *
 * The module holds the one place where a request to Ollama is built:
 * the address, the loopback policy, the timeout, the abort of a
 * cancelled request and the normalization of the errors.
 *
 * Both the chat provider and the model management use it, so the two
 * can never disagree about the address or about what an error means.
 */
import type { ProviderErrorInfo } from '../../../shared/ai-types';
import { redact } from '../redact';
import { isLoopbackUrl } from '../urlPolicy';

/** The default timeout of a request to the local model (milliseconds). */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;

/** The methods the Ollama API uses. */
export type OllamaMethod = 'GET' | 'POST' | 'DELETE';

export interface OllamaRequestOptions {
  /** The address of the service (without a trailing slash). */
  baseUrl: string;
  /** True when the user confirmed an address outside the local machine. */
  remoteConfirmed: boolean;
  /** The HTTP method. */
  method: OllamaMethod;
  /** The path of the endpoint (for example "/api/tags"). */
  endpoint: string;
  /** The body of the request (it is sent as JSON). */
  body?: string;
  /** Aborts the request when the signal fires. */
  signal?: AbortSignal;
  /** The timeout of the request. */
  timeoutMs?: number;
  /** Overrides `fetch` (the tests use it to talk to a mock server). */
  fetchImpl?: typeof fetch;
}

/** The answer of a request that failed. */
export interface OllamaFailure {
  /** The error for the user (it never contains a secret). */
  error: ProviderErrorInfo;
  /** The status of the answer (undefined when there was none). */
  status?: number;
  /** The detail of the answer (it never contains a secret). */
  detail?: string;
}

/** The answer of a request. */
export type OllamaResult =
  | { ok: true; value: Response }
  | ({ ok: false } & OllamaFailure);

/**
 * Performs a request against the Ollama service.
 *
 * The address must point at the local machine, unless the user
 * confirmed it explicitly — otherwise the "LOCAL" badge would be a lie
 * and project content would silently leave the computer (spec §11.1).
 */
export async function ollamaRequest(
  options: OllamaRequestOptions,
): Promise<OllamaResult> {
  const {
    baseUrl,
    remoteConfirmed,
    method,
    endpoint,
    body,
    signal,
    timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  if (!remoteConfirmed && !isLoopbackUrl(baseUrl)) {
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
  }, timeoutMs);

  // The signal of the caller must abort the whole answer — including the
  // body of a streamed response. The timeout only bounds the wait for the
  // headers: it is cleared as soon as the answer arrives.
  const combined = combineSignals(controller.signal, signal);

  try {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body,
      signal: combined,
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      return {
        ok: false,
        status: response.status,
        detail: detail.length > 0 ? detail : undefined,
        error: {
          code: 'unknown',
          message:
            detail.length > 0
              ? detail
              : `Ollama answered with the status ${response.status}.`,
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
  }
}

/**
 * Combines the signal of the timeout with the signal of the caller.
 *
 * The result aborts when either of them fires.
 *
 * @param timeout The signal of the timeout.
 * @param external The signal of the caller (undefined when there is none).
 * @returns The combined signal.
 */
function combineSignals(
  timeout: AbortSignal,
  external: AbortSignal | undefined,
): AbortSignal {
  if (external === undefined) {
    return timeout;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeout, external]);
  }
  // A runtime without AbortSignal.any: the listeners stay attached, so
  // the signal of the caller keeps aborting the answer.
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (timeout.aborted || external.aborted) {
    controller.abort();
  }
  timeout.addEventListener('abort', abort);
  external.addEventListener('abort', abort);
  return controller.signal;
}

/**
 * Reads the error detail of a failed response (never a secret).
 *
 * @param response The failed response.
 * @returns The detail (an empty text when there is none).
 */
export async function readErrorDetail(response: Response): Promise<string> {
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

/**
 * Reads the body of a JSON answer, with a limit.
 *
 * A broken or gigantic answer must never exhaust the memory of the
 * main process (spec §21).
 *
 * @param response The answer.
 * @param maxBytes The maximum number of bytes that are read.
 * @returns The parsed JSON, or null when it could not be read.
 */
export async function readJsonBody(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  try {
    const text = await readLimitedText(response, maxBytes);
    if (text === null) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads the text of a body with a limit.
 *
 * @param response The answer.
 * @param maxBytes The maximum number of bytes that are read.
 * @returns The text, or null when the body is too large or unreadable.
 */
export async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  try {
    const body = response.body;
    if (body === null) {
      const text = await response.text();
      return text.length > maxBytes ? null : text;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        // The rest of the body is dropped: the answer is too large.
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    return null;
  }
}
