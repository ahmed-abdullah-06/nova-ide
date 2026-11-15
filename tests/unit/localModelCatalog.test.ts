/**
 * Tests for the catalog of the local models (spec §11.3).
 *
 * The tests talk to a real HTTP server (a mock Ollama), so the request
 * format, the shape of the answers and the error handling are verified
 * against the actual network stack.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseInstalledModels,
  parseModelDetails,
  parseRunningModels,
} from '../../apps/desktop/src/main/providers/localModels/catalog';
import { LocalModelService } from '../../apps/desktop/src/main/providers/localModels/localModelService';

/** The answers of the mock server, per path. */
interface MockAnswers {
  tags?: unknown;
  ps?: unknown;
  show?: unknown;
  /** The status of every answer. */
  status?: number;
  /** The raw body of the answer (it wins over the parsed ones). */
  body?: string;
}

/** A mock of the Ollama HTTP API. */
class MockOllama {
  private server: Server | null = null;
  private answers: MockAnswers = {};
  /** The requests the server received. */
  readonly requests: { method: string; url: string; body: string }[] = [];

  /** Starts the server on a free port. */
  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        const url = request.url ?? '';
        this.requests.push({
          method: request.method ?? '',
          url,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const status = this.answers.status ?? 200;
        response.writeHead(status, { 'content-type': 'application/json' });
        if (this.answers.body !== undefined) {
          response.end(this.answers.body);
          return;
        }
        if (url.startsWith('/api/tags')) {
          response.end(JSON.stringify(this.answers.tags ?? { models: [] }));
          return;
        }
        if (url.startsWith('/api/ps')) {
          response.end(JSON.stringify(this.answers.ps ?? { models: [] }));
          return;
        }
        if (url.startsWith('/api/show')) {
          response.end(JSON.stringify(this.answers.show ?? {}));
          return;
        }
        response.statusCode = 404;
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  /** Sets what the server answers next. */
  respondWith(answers: MockAnswers): void {
    this.answers = answers;
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }
}

describe('the parser of the catalog of Ollama', () => {
  it('reads the installed models', () => {
    const models = parseInstalledModels({
      models: [
        {
          name: 'llama3:8b',
          model: 'llama3:8b',
          modified_at: '2025-10-03T23:34:03.409490317-07:00',
          size: 4661224676,
          digest: 'abc123',
          details: {
            format: 'gguf',
            family: 'llama',
            families: ['llama'],
            parameter_size: '8.0B',
            quantization_level: 'Q4_K_M',
          },
        },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('llama3:8b');
    expect(models[0]?.sizeBytes).toBe(4661224676);
    expect(models[0]?.parameterSize).toBe('8.0B');
    expect(models[0]?.quantization).toBe('Q4_K_M');
    expect(models[0]?.family).toBe('llama');
    expect(models[0]?.format).toBe('gguf');
    expect(models[0]?.modifiedAt).toBe('2025-10-03T23:34:03.409490317-07:00');
    expect(models[0]?.digest).toBe('abc123');
    expect(models[0]?.loaded).toBe(false);
  });

  it('keeps a missing field unknown instead of guessing', () => {
    const models = parseInstalledModels({
      models: [{ name: 'tiny' }],
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.sizeBytes).toBeUndefined();
    expect(models[0]?.parameterSize).toBeUndefined();
    expect(models[0]?.quantization).toBeUndefined();
    expect(models[0]?.family).toBeUndefined();
    expect(models[0]?.modifiedAt).toBeUndefined();
  });

  it('skips a model without a name', () => {
    const models = parseInstalledModels({
      models: [{ size: 10 }, { name: 'good' }],
    });
    expect(models.map((model) => model.id)).toEqual(['good']);
  });

  it('survives a broken answer', () => {
    expect(parseInstalledModels(null)).toEqual([]);
    expect(parseInstalledModels('nope')).toEqual([]);
    expect(parseInstalledModels({})).toEqual([]);
    expect(parseInstalledModels({ models: 'nope' })).toEqual([]);
    expect(parseRunningModels({ models: [null, 3] })).toEqual([]);
  });

  it('reads the models that are loaded', () => {
    const models = parseRunningModels({
      models: [
        {
          name: 'llama3:8b',
          size: 6591830464,
          digest: 'def456',
          details: { family: 'llama', parameter_size: '8.0B' },
          expires_at: '2025-10-17T16:47:07.93355-07:00',
          size_vram: 5333539264,
          context_length: 4096,
        },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.loaded).toBe(true);
    expect(models[0]?.sizeBytes).toBe(6591830464);
    expect(models[0]?.sizeVramBytes).toBe(5333539264);
    expect(models[0]?.contextLength).toBe(4096);
    expect(models[0]?.expiresAt).toBe('2025-10-17T16:47:07.93355-07:00');
  });

  it('reads the capabilities that Ollama reports', () => {
    const details = parseModelDetails({
      license: 'Apache 2.0',
      parameters: 'temperature 0.7',
      modified_at: '2025-08-14T15:49:43.634137516-07:00',
      details: {
        family: 'qwen3',
        parameter_size: '4.0B',
        quantization_level: 'Q4_K_M',
      },
      capabilities: ['completion', 'tools', 'thinking'],
      model_info: { 'qwen3.context_length': 32768 },
    });
    expect(details.capabilitiesKnown).toBe(true);
    expect(details.supportsToolCalls).toBe(true);
    expect(details.supportsThinking).toBe(true);
    expect(details.supportsVision).toBe(false);
    expect(details.license).toBe('Apache 2.0');
    expect(details.contextLength).toBe(32768);
    expect(details.parameterSize).toBe('4.0B');
  });

  it('does not claim a capability that Ollama did not report', () => {
    const details = parseModelDetails({ license: 'MIT' });
    expect(details.capabilitiesKnown).toBe(false);
    expect(details.supportsToolCalls).toBeUndefined();
    expect(details.supportsVision).toBeUndefined();
    expect(details.capabilities).toBeUndefined();
  });

  it('survives a broken answer of the details', () => {
    const details = parseModelDetails(null);
    expect(details.capabilitiesKnown).toBe(false);
    expect(details.supportsToolCalls).toBeUndefined();
  });
});

describe('the catalog of the local models', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const service = (url = baseUrl): LocalModelService =>
    new LocalModelService({
      target: async () => ({ baseUrl: url, remoteConfirmed: false }),
    });

  it('lists the installed models and marks the loaded ones', async () => {
    mock.respondWith({
      tags: {
        models: [
          { name: 'llama3:8b', size: 100, details: { family: 'llama' } },
          { name: 'qwen2.5:0.5b', size: 200 },
        ],
      },
      ps: { models: [{ name: 'llama3:8b', size: 100 }] },
    });
    const result = await service().catalog();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.installed.map((model) => model.id)).toEqual([
      'llama3:8b',
      'qwen2.5:0.5b',
    ]);
    expect(result.value.installed[0]?.loaded).toBe(true);
    expect(result.value.installed[1]?.loaded).toBe(false);
    expect(result.value.running.map((model) => model.id)).toEqual(['llama3:8b']);
    expect(mock.requests.map((request) => request.url)).toEqual([
      '/api/tags',
      '/api/ps',
    ]);
  });

  it('reports the facts of the machine and the fit of a model', async () => {
    mock.respondWith({
      tags: { models: [{ name: 'tiny', size: 1_000_000 }] },
    });
    const result = await service().catalog();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.hardware.totalRamBytes).toBeGreaterThan(0);
    expect(result.value.hardware.cpuCores).toBeGreaterThan(0);
    expect(result.value.installed[0]?.fit).toBeDefined();
    expect(result.value.installed[0]?.fitNote).toBeTruthy();
  });

  it('reports that too many large models are loaded', async () => {
    mock.respondWith({
      tags: { models: [] },
      ps: {
        models: [
          { name: 'big-a', size: 9_000_000_000 },
          { name: 'big-b', size: 9_000_000_000 },
        ],
      },
    });
    const result = await service().catalog();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.tooManyLoaded).toBe(true);
    expect(result.value.maxConcurrentLoaded).toBe(1);
  });

  it('does not complain when only one large model is loaded', async () => {
    mock.respondWith({
      tags: { models: [] },
      ps: {
        models: [
          { name: 'big-a', size: 9_000_000_000 },
          { name: 'small', size: 1_000_000 },
        ],
      },
    });
    const result = await service().catalog();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tooManyLoaded).toBe(false);
    }
  });

  it('unloads a second large model before a local request', async () => {
    mock.respondWith({
      tags: { models: [] },
      ps: {
        models: [
          { name: 'big-a', size: 9_000_000_000 },
          { name: 'big-b', size: 9_000_000_000 },
        ],
      },
    });
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      getActiveModels: () => [],
    });
    await service.ensureSingleLoadedModel('big-c');
    const generate = mock.requests.find(
      (request) => request.url === '/api/generate',
    );
    expect(generate).toBeDefined();
    expect(JSON.parse(generate?.body ?? '{}')).toEqual({
      model: 'big-a',
      keep_alive: 0,
    });
  });

  it('never unloads a model that a running request uses', async () => {
    mock.respondWith({
      tags: { models: [] },
      ps: {
        models: [
          { name: 'big-a', size: 9_000_000_000 },
          { name: 'big-b', size: 9_000_000_000 },
        ],
      },
    });
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      getActiveModels: () => ['big-a'],
    });
    await service.ensureSingleLoadedModel('big-c');
    const generate = mock.requests.find(
      (request) => request.url === '/api/generate',
    );
    // The model of the running request is never unloaded; the other one
    // is released, so only one large model stays in the memory.
    if (generate !== undefined) {
      expect(JSON.parse(generate.body).model).toBe('big-b');
    }
    expect(
      mock.requests.filter((request) => request.url === '/api/generate'),
    ).toHaveLength(1);
  });

  it('reports a service that does not run', async () => {
    const result = await service('http://127.0.0.1:1').catalog();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-running');
      expect(result.error.message).toContain('Ollama');
    }
  });

  it('refuses an address outside of the machine', async () => {
    mock.respondWith({ tags: { models: [] } });
    const remote = new LocalModelService({
      target: async () => ({
        baseUrl: 'http://example.com:11434',
        remoteConfirmed: false,
      }),
    });
    const result = await remote.catalog();
    expect(result.ok).toBe(false);
    // Nothing was sent to the remote address.
    expect(mock.requests).toHaveLength(0);
  });

  it('reads the details of a model', async () => {
    mock.respondWith({
      show: {
        license: 'Apache 2.0',
        capabilities: ['completion', 'tools'],
        details: { family: 'qwen3', parameter_size: '4.0B' },
      },
      tags: { models: [{ name: 'qwen3:4b', size: 1234 }] },
    });
    const result = await service().details('qwen3:4b');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.capabilitiesKnown).toBe(true);
    expect(result.value.supportsToolCalls).toBe(true);
    expect(result.value.sizeBytes).toBe(1234);
    expect(result.value.license).toBe('Apache 2.0');
  });

  it('refuses a name that is not a model name', async () => {
    const result = await service().details('../../etc/passwd');
    expect(result.ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it('reports a model that does not exist', async () => {
    mock.respondWith({
      status: 404,
      body: JSON.stringify({ error: 'model "nope" not found' }),
    });
    const result = await service().details('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('model-not-found');
    }
  });
});
