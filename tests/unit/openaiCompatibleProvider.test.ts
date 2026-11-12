/**
 * Tests for the OpenAI compatible cloud provider (spec §11.4).
 *
 * The tests talk to a real mock server, so the request format, the
 * streaming format, the rate limits and the error handling are verified
 * against the actual network stack. No paid service is contacted.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from '../../apps/desktop/src/main/providers/openai/openaiCompatibleProvider';

/** What the mock server answers. */
interface MockBehaviour {
  status?: number;
  body?: string;
  chunks?: string[];
  headers?: Record<string, string>;
  /** The number of answers before the server answers with `status`. */
  failTimes?: number;
}

/** A mock of an OpenAI compatible service. */
class MockCloud {
  private server: Server | null = null;
  private behaviour: MockBehaviour = {};
  private failures = 0;
  /** The requests the server received. */
  readonly requests: { method: string; url: string; body: string; auth: string | undefined }[] = [];

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: string[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString('utf8'));
      });
      request.on('end', () => {
        this.requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          body: chunks.join(''),
          auth: request.headers.authorization,
        });
        const behaviour = this.behaviour;
        const rateLimited =
          behaviour.status === 429 && this.failures < (behaviour.failTimes ?? 0);
        if (rateLimited) {
          this.failures += 1;
          response.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': behaviour.headers?.['retry-after'] ?? '1',
          });
          response.end(JSON.stringify({ error: 'rate limit reached' }));
          return;
        }
        response.writeHead(behaviour.status ?? 200, {
          'content-type': behaviour.headers?.['content-type'] ?? 'application/json',
          ...(behaviour.headers ?? {}),
        });
        if (behaviour.chunks !== undefined) {
          const parts = behaviour.chunks;
          let index = 0;
          const writeNext = (): void => {
            if (index >= parts.length) {
              response.end();
              return;
            }
            response.write(parts[index] ?? '');
            index += 1;
            setTimeout(writeNext, 5);
          };
          writeNext();
          return;
        }
        response.end(behaviour.body ?? '{}');
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/v1`;
  }

  respondWith(behaviour: MockBehaviour): void {
    this.behaviour = behaviour;
    this.failures = 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }
}

/** Collects the events of a streamed answer. */
async function collect(
  provider: OpenAiCompatibleProvider,
  signal = new AbortController().signal,
): Promise<{ events: string[]; text: string }> {
  const events: string[] = [];
  let text = '';
  for await (const event of provider.chat({
    requestId: 'r1',
    messages: [{ role: 'user', content: 'Hello' }],
    options: { model: 'gpt-test' },
    signal,
  })) {
    events.push(event.type);
    if (event.type === 'text') {
      text += event.delta;
    }
  }
  return { events, text };
}

describe('openai compatible provider', () => {
  let mock: MockCloud;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockCloud();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('lists the models of the service', async () => {
    mock.respondWith({
      body: JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'gpt-other' }] }),
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    const result = await provider.listModels();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual([
        'gpt-test',
        'gpt-other',
      ]);
    }
  });

  it('sends the key in the authorization header', async () => {
    mock.respondWith({ body: JSON.stringify({ data: [] }) });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    await provider.listModels();
    expect(mock.requests[0]?.auth).toBe('Bearer sk-test');
  });

  it('refuses to work without a key', async () => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: null });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('unauthorized');
    expect(status.message).toContain('API key');
    // Nothing was sent.
    expect(mock.requests).toHaveLength(0);
  });

  it('reports a rejected key', async () => {
    mock.respondWith({
      status: 401,
      body: JSON.stringify({ error: 'invalid api key' }),
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-bad' });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('unauthorized');
    // The message of the service must not be shown verbatim.
    expect(status.message).not.toContain('sk-bad');
  });

  it('retries a rate limit and reports it when it persists', async () => {
    mock.respondWith({
      status: 429,
      body: JSON.stringify({ error: 'slow down' }),
      headers: { 'retry-after': '0' },
      failTimes: 99,
    });
    const provider = new OpenAiCompatibleProvider({
      baseUrl,
      apiKey: 'sk-test',
      maxRetries: 1,
    });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('rate-limited');
    // The first attempt and one retry.
    expect(mock.requests).toHaveLength(2);
  });

  it('waits for the time the service asked for', async () => {
    mock.respondWith({
      status: 429,
      body: JSON.stringify({ error: 'slow down' }),
      headers: { 'retry-after': '1' },
      failTimes: 1,
    });
    const provider = new OpenAiCompatibleProvider({
      baseUrl,
      apiKey: 'sk-test',
      maxRetries: 2,
    });
    const started = Date.now();
    const status = await provider.checkConnection();
    const elapsed = Date.now() - started;
    expect(status.available).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(mock.requests.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a model that the service does not know', async () => {
    mock.respondWith({
      status: 404,
      body: JSON.stringify({ error: 'model not found' }),
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    const { events } = await collect(provider);
    expect(events).toEqual(['error']);
  });

  it('reports a network error', async () => {
    // A port that nothing listens on.
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-test',
    });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('network');
  });

  it('streams an answer', async () => {
    mock.respondWith({
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ],
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    const result = await collect(provider);
    expect(result.text).toBe('Hello');
    expect(result.events).toContain('start');
    expect(result.events).toContain('finish');
  });

  it('sends the messages and the options', async () => {
    mock.respondWith({
      headers: { 'content-type': 'text/event-stream' },
      chunks: ['data: [DONE]\n\n'],
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    for await (const _event of provider.chat({
      requestId: 'r1',
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hello' },
      ],
      options: { model: 'gpt-test', temperature: 0.2, maxTokens: 100 },
      signal: new AbortController().signal,
    })) {
      // The stream is consumed.
    }
    const body = JSON.parse(mock.requests[0]?.body ?? '{}') as {
      model: string;
      stream: boolean;
      temperature: number;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('gpt-test');
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(100);
    expect(body.messages).toHaveLength(2);
  });

  it('aborts a running request', async () => {
    mock.respondWith({
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        'data: {"choices":[{"delta":{"content":"one"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"two"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"three"}}]}\n\n',
      ],
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    const controller = new AbortController();
    const events: string[] = [];
    for await (const event of provider.chat({
      requestId: 'r1',
      messages: [{ role: 'user', content: 'Hello' }],
      options: { model: 'gpt-test' },
      signal: controller.signal,
    })) {
      events.push(event.type);
      if (event.type === 'text') {
        controller.abort();
      }
    }
    expect(events).toContain('text');
    expect(controller.signal.aborted).toBe(true);
  });

  it('reports a malformed stream instead of crashing', async () => {
    mock.respondWith({
      headers: { 'content-type': 'text/event-stream' },
      chunks: ['data: not json\n\n'],
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, apiKey: 'sk-test' });
    const { events } = await collect(provider);
    expect(events).toContain('error');
  });

  it('never leaks the key in an error message', async () => {
    mock.respondWith({
      status: 500,
      body: 'the server exploded with sk-super-secret-key',
    });
    const provider = new OpenAiCompatibleProvider({
      baseUrl,
      apiKey: 'sk-super-secret-key',
    });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.message ?? '').not.toContain('sk-super-secret-key');
  });
});
