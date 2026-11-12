/**
 * The provider router (spec §10.3).
 *
 * The router owns the running requests: it starts them on the provider
 * the user picked, forwards the normalized events to the renderer and
 * makes sure that a cancelled request really aborts the underlying
 * network request.
 *
 * Limits (spec §21):
 *  - at most `MAX_CONCURRENT_REQUESTS` requests run at the same time,
 *  - a single answer is capped at `MAX_RESPONSE_CHARS`, so a runaway
 *    model cannot exhaust the memory,
 *  - every request is aborted when the application quits.
 */
import type {
  AIStreamEvent,
  AiResult,
  ChatMessage,
  ChatOptions,
  ProviderErrorInfo,
} from '../../shared/ai-types';
import type { AIProvider } from './interfaces/provider';

/** The maximum number of requests that run at the same time. */
export const MAX_CONCURRENT_REQUESTS = 3;
/** The maximum number of characters of one answer. */
export const MAX_RESPONSE_CHARS = 1_000_000;

/** A request that is currently running. */
interface RunningRequest {
  controller: AbortController;
  providerId: string;
}

export interface ProviderRouterOptions {
  /** Called for every event of every running request. */
  onEvent: (requestId: string, event: AIStreamEvent) => void;
  /** Returns the provider with the given id. */
  resolve: (
    providerId: string,
  ) => AIProvider | null | undefined | Promise<AIProvider | null | undefined>;
}

export class ProviderRouter {
  private readonly options: ProviderRouterOptions;
  /** The requests that are currently running. */
  private readonly running = new Map<string, RunningRequest>();

  constructor(options: ProviderRouterOptions) {
    this.options = options;
  }

  /** The number of requests that are currently running. */
  get runningCount(): number {
    return this.running.size;
  }

  /** True when a request with the given id is running. */
  isRunning(requestId: string): boolean {
    return this.running.has(requestId);
  }

  /**
   * Starts a chat request.
   *
   * The events are delivered through `onEvent`; the returned result only
   * reports whether the request was accepted.
   */
  async start(
    requestId: string,
    providerId: string,
    messages: ChatMessage[],
    options: ChatOptions,
  ): Promise<AiResult<{ requestId: string }>> {
    if (this.running.has(requestId)) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'This request is already running.',
        },
      };
    }
    if (this.running.size >= MAX_CONCURRENT_REQUESTS) {
      return {
        ok: false,
        error: {
          code: 'rate-limited',
          message:
            'Too many requests are running at the same time. ' +
            'Wait for one to finish and try again.',
        },
      };
    }

    const provider = await this.options.resolve(providerId);
    if (provider === undefined || provider === null) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }

    const controller = new AbortController();
    this.running.set(requestId, { controller, providerId });

    // The stream is consumed in the background: the renderer receives the
    // events through the push channel.
    void this.consume(
      requestId,
      provider,
      messages,
      options,
      controller.signal,
    );

    return { ok: true, value: { requestId } };
  }

  /**
   * Cancels a running request.
   *
   * The abort signal really stops the underlying request.
   */
  cancel(requestId: string): AiResult<void> {
    const request = this.running.get(requestId);
    if (request === undefined) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The request is no longer running.',
        },
      };
    }
    request.controller.abort();
    this.running.delete(requestId);
    return { ok: true, value: undefined };
  }

  /** Cancels every running request (the application quits). */
  cancelAll(): void {
    for (const request of this.running.values()) {
      request.controller.abort();
    }
    this.running.clear();
  }

  /**
   * Reads the stream of a provider and forwards the events.
   *
   * The answer is capped: the events after the cap are dropped and the
   * request ends with a `length` finish reason.
   */
  private async consume(
    requestId: string,
    provider: AIProvider,
    messages: ChatMessage[],
    options: ChatOptions,
    signal: AbortSignal,
  ): Promise<void> {
    let received = 0;
    let finished = false;

    const emit = (event: AIStreamEvent): void => {
      if (finished) {
        return;
      }
      if (event.type === 'text') {
        received += event.delta.length;
        if (received > MAX_RESPONSE_CHARS) {
          finished = true;
          this.options.onEvent(requestId, {
            type: 'finish',
            reason: 'length',
          });
          return;
        }
      }
      if (event.type === 'finish' || event.type === 'error') {
        finished = true;
      }
      this.options.onEvent(requestId, event);
    };

    try {
      for await (const event of provider.chat({
        requestId,
        messages,
        options,
        signal,
      })) {
        if (finished) {
          break;
        }
        emit(event);
      }
      if (!finished) {
        emit({ type: 'finish', reason: signal.aborted ? 'cancelled' : 'stop' });
      }
    } catch (error) {
      emit({
        type: 'error',
        error: toProviderError(error, signal.aborted),
      });
    } finally {
      this.running.delete(requestId);
    }
  }
}

/** Converts an unexpected error into a user-facing provider error. */
export function toProviderError(
  error: unknown,
  cancelled = false,
): ProviderErrorInfo {
  if (cancelled) {
    return { code: 'cancelled', message: 'The request was cancelled.' };
  }
  if (error instanceof Error) {
    // The message of a provider error is written for the user; it never
    // contains a key (the adapters redact before they throw).
    return { code: 'unknown', message: error.message };
  }
  return { code: 'unknown', message: 'The request failed.' };
}
