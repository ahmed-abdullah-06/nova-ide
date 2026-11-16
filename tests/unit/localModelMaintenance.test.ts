/**
 * Tests for the deletion and the unload of a local model
 * (spec §11.3, §19.2).
 *
 * The tests talk to a real HTTP server (a mock Ollama), so the request
 * format of `/api/delete` and `/api/generate` is verified against the
 * actual network stack.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalModelService } from '../../apps/desktop/src/main/providers/localModels/localModelService';

/** A mock of the Ollama HTTP API. */
class MockOllama {
  private server: Server | null = null;
  /** The requests the server received. */
  readonly requests: { method: string; url: string; body: string }[] = [];
  /** The status of the next answer. */
  status = 200;
  /** The body of the next answer. */
  body = '{}';

  /** Starts the server on a free port. */
  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        this.requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(this.status, { 'content-type': 'application/json' });
        response.end(this.body);
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }
}

describe('the deletion of a local model', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const service = (activeModels: string[] = []): LocalModelService =>
    new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      getActiveModels: () => activeModels,
    });

  it('deletes a model', async () => {
    const result = await service().delete('qwen2.5:7b');
    expect(result.ok).toBe(true);
    const request = mock.requests.find(
      (entry) => entry.url === '/api/delete',
    );
    expect(request?.method).toBe('DELETE');
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ model: 'qwen2.5:7b' });
  });

  it('refuses to delete a model that a running request uses', async () => {
    const result = await service(['qwen2.5:7b']).delete('qwen2.5:7b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('in-use');
      expect(result.error.message).toContain('running request');
    }
    // Nothing was sent to Ollama.
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses a name that is not a model name', async () => {
    const result = await service().delete('http://example.com/model');
    expect(result.ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it('reports a model that does not exist', async () => {
    mock.status = 404;
    mock.body = JSON.stringify({ error: 'model "nope" not found' });
    const result = await service().delete('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('model-not-found');
    }
  });

  it('reports a disk that is full', async () => {
    mock.status = 500;
    mock.body = JSON.stringify({ error: 'not enough space on disk' });
    const result = await service().delete('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no-space');
    }
  });

  it('refuses an address outside of the machine', async () => {
    const remote = new LocalModelService({
      target: async () => ({
        baseUrl: 'http://example.com:11434',
        remoteConfirmed: false,
      }),
    });
    const result = await remote.delete('qwen2.5:7b');
    expect(result.ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('the unload of a local model', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const service = (activeModels: string[] = []): LocalModelService =>
    new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      getActiveModels: () => activeModels,
    });

  it('unloads a model with keep_alive 0', async () => {
    const result = await service().unload('qwen2.5:7b');
    expect(result.ok).toBe(true);
    const request = mock.requests.find(
      (entry) => entry.url === '/api/generate',
    );
    expect(request?.method).toBe('POST');
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      model: 'qwen2.5:7b',
      keep_alive: 0,
    });
  });

  it('refuses to unload a model that a running request uses', async () => {
    const result = await service(['qwen2.5:7b']).unload('qwen2.5:7b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('in-use');
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses a name that is not a model name', async () => {
    const result = await service().unload('../../etc/passwd');
    expect(result.ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });
});
