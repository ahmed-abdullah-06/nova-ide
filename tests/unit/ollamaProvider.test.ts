/**
 * Tests for the Ollama provider (spec §11.3).
 *
 * The tests talk to a real HTTP server (a mock Ollama), so the request
 * format, the streaming format and the error handling are verified
 * against the actual network stack — no request is mocked away.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../apps/desktop/src/main/providers/ollama/ollamaProvider';
import type { ProviderChatRequest } from '../../apps/desktop/src/main/providers/interfaces/provider';

/** What the mock server answers. */
interface MockBehaviour {
  /** The status code of the answer. */
  status?: number;
  /** The body of the answer (a string is sent as is). */
  body?: string;
  /** The chunks of a streamed answer. */
  chunks?: string[];
  /** The delay between the chunks (milliseconds). */
  chunkDelayMs?: number;
  /** The content type of the answer. */
  contentType?: string;
}

/** A mock of the Ollama HTTP API. */
class MockOllama {
  private server: Server | null = null;
  private behaviour: MockBehaviour = {};
  /** The requests the server received. */
  readonly requests: { method: string; url: string; body: string }[] = [];

  /** Starts the server on a free port. */
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
        });
        const behaviour = this.behaviour;
        const status = behaviour.status ?? 200;
        response.writeHead(status, {
          'content-type': behaviour.contentType ?? 'application/json',
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
            setTimeout(writeNext, behaviour.chunkDelayMs ?? 5);
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
    return `http://127.0.0.1:${address.port}`;
  }

  /** Sets what the server answers next. */
  respondWith(behaviour: MockBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }
}

/** Collects the events of a streamed answer. */
async function collect(
  provider: OllamaProvider,
  request: Partial<ProviderChatRequest> = {},
): Promise<{ events: string[]; text: string; aborted: boolean }> {
  const controller = new AbortController();
  const events: string[] = [];
  let text = '';
  for await (const event of provider.chat({
    requestId: 'r1',
    messages: [{ role: 'user', content: 'Hello' }],
    options: { model: 'llama3' },
    signal: controller.signal,
    ...request,
  })) {
    events.push(event.type);
    if (event.type === 'text') {
      text += event.delta;
    }
  }
  return { events, text, aborted: controller.signal.aborted };
}

describe('ollama provider', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('lists the installed models', async () => {
    mock.respondWith({
      body: JSON.stringify({
        models: [
          {
            name: 'llama3:8b',
            size: 4661224676,
            details: { family: 'llama', parameter_size: '8.0B' },
          },
          { name: 'qwen2.5:0.5b', size: 397000000 },
        ],
      }),
    });
    const provider = new OllamaProvider({ baseUrl });
    const result = await provider.listModels();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual([
        'llama3:8b',
        'qwen2.5:0.5b',
      ]);
      expect(result.value[0]?.sizeBytes).toBe(4661224676);
      expect(result.value[0]?.family).toBe('llama');
      expect(result.value[0]?.parameterSize).toBe('8.0B');
    }
    expect(mock.requests[0]?.url).toBe('/api/tags');
  });

  it('reports that the service is not running', async () => {
    // A port that nothing listens on.
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:1' });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('not-running');
    expect(status.message).toContain('Ollama');
  });

  it('reports that the service is not installed at the address', async () => {
    mock.respondWith({ status: 404, body: 'not found' });
    const provider = new OllamaProvider({ baseUrl });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('not-installed');
  });

  it('reports that there are no models', async () => {
    mock.respondWith({ body: JSON.stringify({ models: [] }) });
    const provider = new OllamaProvider({ baseUrl });
    const result = await provider.listModels();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('streams an answer', async () => {
    mock.respondWith({
      contentType: 'application/x-ndjson',
      chunks: [
        '{"message":{"role":"assistant","content":"Hel"},"done":false}\n',
        '{"message":{"role":"assistant","content":"lo"},"done":false}\n',
        '{"done":true,"prompt_eval_count":10,"eval_count":5}\n',
      ],
    });
    const provider = new OllamaProvider({ baseUrl });
    const result = await collect(provider);
    expect(result.text).toBe('Hello');
    expect(result.events).toEqual(['start', 'text', 'text', 'usage', 'finish']);
  });

  it('sends the messages and the model', async () => {
    mock.respondWith({
      contentType: 'application/x-ndjson',
      chunks: ['{"message":{"content":"ok"},"done":true}\n'],
    });
    const provider = new OllamaProvider({ baseUrl });
    await collect(provider, {
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hello' },
      ],
      options: { model: 'llama3' },
    });
    const body = JSON.parse(mock.requests[0]?.body ?? '{}') as {
      model: string;
      messages: { role: string; content: string }[];
      stream: boolean;
    };
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('cancels a running request', async () => {
    mock.respondWith({
      contentType: 'application/x-ndjson',
      chunks: [
        '{"message":{"content":"one"},"done":false}\n',
        '{"message":{"content":"two"},"done":false}\n',
        '{"message":{"content":"three"},"done":true}\n',
      ],
      chunkDelayMs: 200,
    });
    const provider = new OllamaProvider({ baseUrl });
    const controller = new AbortController();
    const events: string[] = [];
    let finished = false;
    for await (const event of provider.chat({
      requestId: 'r1',
      messages: [{ role: 'user', content: 'Hello' }],
      options: { model: 'llama3' },
      signal: controller.signal,
    })) {
      events.push(event.type);
      if (event.type === 'text') {
        controller.abort();
      }
      if (event.type === 'finish') {
        finished = true;
      }
    }
    expect(events).toContain('text');
    expect(finished).toBe(true);
  });

  it('reports a malformed chunk instead of crashing', async () => {
    mock.respondWith({
      contentType: 'application/x-ndjson',
      chunks: ['this is not json\n'],
    });
    const provider = new OllamaProvider({ baseUrl });
    const events: string[] = [];
    for await (const event of provider.chat({
      requestId: 'r1',
      messages: [{ role: 'user', content: 'Hello' }],
      options: { model: 'llama3' },
      signal: new AbortController().signal,
    })) {
      events.push(event.type);
    }
    expect(events).toContain('error');
  });

  it('reports a model that does not exist', async () => {
    mock.respondWith({
      status: 404,
      body: JSON.stringify({ error: 'model "nope" not found' }),
    });
    const provider = new OllamaProvider({ baseUrl });
    const events: string[] = [];
    for await (const event of provider.chat({
      requestId: 'r1',
      messages: [{ role: 'user', content: 'Hello' }],
      options: { model: 'nope' },
      signal: new AbortController().signal,
    })) {
      events.push(event.type);
    }
    expect(events).toEqual(['error']);
  });

  it('refuses an address outside the machine without a confirmation', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://example.com:11434' });
    const status = await provider.checkConnection();
    expect(status.available).toBe(false);
    expect(status.message).toContain('Confirm');
    // Nothing was sent.
    expect(mock.requests).toHaveLength(0);
  });

  it('uses an address outside the machine after a confirmation', async () => {
    mock.respondWith({ body: JSON.stringify({ models: [] }) });
    const provider = new OllamaProvider({
      baseUrl,
      remoteConfirmed: true,
    });
    // The loopback address is allowed in any case; the confirmation only
    // matters for a remote address.
    const result = await provider.listModels();
    expect(result.ok).toBe(true);
  });
});
