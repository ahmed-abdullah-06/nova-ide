/**
 * Tests for the provider abstraction (spec §11.2).
 *
 * The tests use a fake provider, so they verify the contract itself — not
 * a particular service. The real adapters are tested against mock servers
 * in their own suites.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  AIStreamEvent,
  AiResult,
  ChatMessage,
  ProviderCapabilities,
  ProviderModel,
  ProviderStatus,
} from '../../apps/desktop/src/shared/ai-types';
import type {
  AIProvider,
  ProviderChatRequest,
} from '../../apps/desktop/src/main/providers/interfaces/provider';
import { ProviderRegistry } from '../../apps/desktop/src/main/providers/registry';
import {
  MAX_CONCURRENT_REQUESTS,
  MAX_RESPONSE_CHARS,
  ProviderRouter,
} from '../../apps/desktop/src/main/providers/router';

/** A provider that can be steered by the test. */
class FakeProvider implements AIProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'local' | 'cloud';
  /** The requests the provider received. */
  readonly requests: ProviderChatRequest[] = [];
  /** The events the provider yields. */
  events: AIStreamEvent[] = [
    { type: 'start', model: 'fake-model' },
    { type: 'text', delta: 'Hello' },
    { type: 'finish', reason: 'stop' },
  ];
  /** The status the connection check reports. */
  status: ProviderStatus = { available: true };
  /** The models the provider offers. */
  models: ProviderModel[] = [{ id: 'fake-model', name: 'Fake model' }];
  /** Thrown instead of streaming. */
  failure: Error | null = null;
  /** Resolves when the request was aborted. */
  aborted = false;
  /** True while the request stays open until it is aborted. */
  holdOpen = false;

  constructor(id = 'fake', kind: 'local' | 'cloud' = 'local') {
    this.id = id;
    this.name = `Fake ${id}`;
    this.kind = kind;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolCalls: false,
      vision: false,
      structuredOutput: false,
      systemPrompt: true,
      local: this.kind === 'local',
    };
  }

  async listModels(): Promise<AiResult<ProviderModel[]>> {
    return { ok: true, value: this.models };
  }

  async checkConnection(): Promise<ProviderStatus> {
    return this.status;
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<AIStreamEvent> {
    this.requests.push(request);
    if (this.failure !== null) {
      throw this.failure;
    }
    for (const event of this.events) {
      if (request.signal.aborted) {
        this.aborted = true;
        return;
      }
      yield event;
      // Give the consumer a chance to abort between the events.
      await Promise.resolve();
    }
    if (this.holdOpen) {
      // The request stays open until it is aborted.
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) {
          this.aborted = true;
          resolve();
          return;
        }
        request.signal.addEventListener('abort', () => {
          this.aborted = true;
          resolve();
        });
      });
    }
  }
}

describe('provider interface contract', () => {
  it('describes what a provider can do', () => {
    const provider = new FakeProvider();
    const capabilities = provider.getCapabilities();
    expect(capabilities.streaming).toBe(true);
    expect(capabilities.toolCalls).toBe(false);
    expect(capabilities.local).toBe(true);
  });

  it('lists the models of the provider', async () => {
    const provider = new FakeProvider();
    const result = await provider.listModels();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual(['fake-model']);
    }
  });

  it('reports the connection state', async () => {
    const provider = new FakeProvider();
    expect((await provider.checkConnection()).available).toBe(true);
    provider.status = { available: false, reason: 'not-running' };
    expect((await provider.checkConnection()).reason).toBe('not-running');
  });
});

describe('provider registry', () => {
  it('registers and finds providers', () => {
    const registry = new ProviderRegistry();
    const provider = new FakeProvider('ollama');
    registry.register(provider);
    expect(registry.get('ollama')).toBe(provider);
    expect(registry.has('ollama')).toBe(true);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('replaces a provider with the same id', () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('ollama'));
    const second = new FakeProvider('ollama');
    registry.register(second);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('ollama')).toBe(second);
  });

  it('describes the providers without a key', () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('ollama', 'local'));
    const descriptors = registry.describe(() => ({
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      hasKey: false,
      remoteConfirmed: false,
    }));
    expect(descriptors).toEqual([
      {
        id: 'ollama',
        name: 'Fake ollama',
        kind: 'local',
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        hasKey: false,
        remoteConfirmed: false,
      },
    ]);
    expect(JSON.stringify(descriptors)).not.toContain('key');
  });
});

describe('provider router', () => {
  /** Collects the events of a router. */
  function createRouter(provider: AIProvider) {
    const events: { requestId: string; event: AIStreamEvent }[] = [];
    const router = new ProviderRouter({
      onEvent: (requestId, event) => {
        events.push({ requestId, event });
      },
      resolve: (providerId) => (providerId === provider.id ? provider : undefined),
    });
    return { router, events };
  }

  const message: ChatMessage = { role: 'user', content: 'Hello' };

  it('routes a request to the selected provider', async () => {
    const provider = new FakeProvider('ollama');
    const { router, events } = createRouter(provider);
    const result = await router.start('r1', 'ollama', [message], {
      model: 'fake-model',
    });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => {
      expect(events.some((entry) => entry.event.type === 'finish')).toBe(true);
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages).toEqual([message]);
  });

  it('refuses an unknown provider', async () => {
    const provider = new FakeProvider('ollama');
    const { router } = createRouter(provider);
    const result = await router.start('r1', 'missing', [message], {
      model: 'fake-model',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not available');
    }
  });

  it('refuses the same request id twice', async () => {
    const provider = new FakeProvider('ollama');
    const { router } = createRouter(provider);
    await router.start('r1', 'ollama', [message], { model: 'fake-model' });
    const second = await router.start('r1', 'ollama', [message], {
      model: 'fake-model',
    });
    expect(second.ok).toBe(false);
  });

  it('cancels a running request and aborts the provider', async () => {
    const provider = new FakeProvider('ollama');
    provider.events = [{ type: 'start', model: 'fake-model' }];
    const { router } = createRouter(provider);
    await router.start('r1', 'ollama', [message], { model: 'fake-model' });
    expect(router.isRunning('r1')).toBe(true);
    const cancelled = router.cancel('r1');
    expect(cancelled.ok).toBe(true);
    expect(provider.requests[0]?.signal.aborted).toBe(true);
    expect(router.isRunning('r1')).toBe(false);
  });

  it('refuses to cancel an unknown request', () => {
    const provider = new FakeProvider('ollama');
    const { router } = createRouter(provider);
    const cancelled = router.cancel('missing');
    expect(cancelled.ok).toBe(false);
  });

  it('caps the number of parallel requests', async () => {
    const provider = new FakeProvider('ollama');
    provider.events = [{ type: 'start', model: 'fake-model' }];
    provider.holdOpen = true;
    const { router } = createRouter(provider);
    for (let index = 0; index < MAX_CONCURRENT_REQUESTS; index += 1) {
      const result = await router.start(`r${index}`, 'ollama', [message], {
        model: 'fake-model',
      });
      expect(result.ok).toBe(true);
    }
    const rejected = await router.start('too-many', 'ollama', [message], {
      model: 'fake-model',
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('rate-limited');
    }
    expect(router.runningCount).toBe(MAX_CONCURRENT_REQUESTS);
    router.cancelAll();
  });

  it('caps the length of an answer', async () => {
    const provider = new FakeProvider('ollama');
    provider.events = [
      { type: 'text', delta: 'x'.repeat(MAX_RESPONSE_CHARS + 10) },
      { type: 'text', delta: 'more' },
      { type: 'finish', reason: 'stop' },
    ];
    const { router, events } = createRouter(provider);
    await router.start('r1', 'ollama', [message], { model: 'fake-model' });
    await vi.waitFor(() => {
      expect(events.some((entry) => entry.event.type === 'finish')).toBe(true);
    });
    const finish = events.find((entry) => entry.event.type === 'finish');
    expect(finish?.event).toEqual({ type: 'finish', reason: 'length' });
  });

  it('turns a provider failure into an error event', async () => {
    const provider = new FakeProvider('ollama');
    provider.failure = new Error('the provider exploded');
    const { router, events } = createRouter(provider);
    await router.start('r1', 'ollama', [message], { model: 'fake-model' });
    await vi.waitFor(() => {
      expect(events.some((entry) => entry.event.type === 'error')).toBe(true);
    });
    const error = events.find((entry) => entry.event.type === 'error');
    expect(error?.event.type === 'error' && error.event.error.message).toContain(
      'exploded',
    );
  });

  it('cancels every request when the application quits', async () => {
    const provider = new FakeProvider('ollama');
    provider.events = [{ type: 'start', model: 'fake-model' }];
    const { router } = createRouter(provider);
    await router.start('r1', 'ollama', [message], { model: 'fake-model' });
    router.cancelAll();
    expect(provider.requests[0]?.signal.aborted).toBe(true);
    expect(router.runningCount).toBe(0);
  });
});
