/**
 * Tests for the safety and the limits of the model management
 * (spec §19.2, §19.5, §21).
 *
 * The tests prove that:
 *  - the address of Ollama must point at this machine,
 *  - the size of the lists, of the answers and of the progress updates
 *    is bounded,
 *  - a secret never reaches a message of the user interface,
 *  - the agent can never download, delete or unload a model.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalModelService } from '../../apps/desktop/src/main/providers/localModels/localModelService';
import { AGENT_TOOLS } from '../../apps/desktop/src/main/agent/tools';
import { MAX_LISTED_MODELS } from '../../apps/desktop/src/shared/local-model-types';
import type { LocalDownloadProgress } from '../../apps/desktop/src/shared/local-model-types';

/** A mock of the Ollama HTTP API. */
class MockOllama {
  private server: Server | null = null;
  /** The body of the answer of /api/tags. */
  tags = '{"models":[]}';
  /** The body of the answer of /api/pull. */
  pull = '{"status":"success"}\n';
  /** The status of the answer. */
  status = 200;

  /** Starts the server on a free port. */
  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        const url = request.url ?? '';
        response.writeHead(this.status, {
          'content-type': 'application/x-ndjson',
        });
        if (url.startsWith('/api/pull')) {
          response.end(this.pull);
          return;
        }
        if (url.startsWith('/api/tags')) {
          response.end(this.tags);
          return;
        }
        response.end('{"models":[]}');
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

describe('the safety of the model management', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const service = (remoteConfirmed = false): LocalModelService =>
    new LocalModelService({
      target: async () => ({
        baseUrl: remoteConfirmed ? 'http://example.com:11434' : baseUrl,
        remoteConfirmed,
      }),
    });

  it('refuses an address outside of the machine', async () => {
    let called = false;
    const remote = new LocalModelService({
      target: async () => ({
        baseUrl: 'http://example.com:11434',
        remoteConfirmed: false,
      }),
      fetchImpl: async () => {
        called = true;
        return new Response('{"models":[]}', {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const catalog = await remote.catalog();
    expect(catalog.ok).toBe(false);
    if (!catalog.ok) {
      expect(catalog.error.message).toContain('not on this machine');
    }
    // Nothing was sent to the remote address.
    expect(called).toBe(false);
  });

  it('works on an address outside of the machine after the confirmation', async () => {
    let called = false;
    const remote = new LocalModelService({
      target: async () => ({
        baseUrl: 'http://example.com:11434',
        remoteConfirmed: true,
      }),
      fetchImpl: async () => {
        called = true;
        return new Response('{"models":[]}', {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const catalog = await remote.catalog();
    expect(catalog.ok).toBe(true);
    // The confirmation lets the request through.
    expect(called).toBe(true);
  });

  it('caps the number of the listed models', async () => {
    const models = [];
    for (let index = 0; index < MAX_LISTED_MODELS + 50; index += 1) {
      models.push({ name: `model-${index}`, size: 10 });
    }
    mock.tags = JSON.stringify({ models });
    const result = await service().catalog();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.installed).toHaveLength(MAX_LISTED_MODELS);
      expect(result.value.truncated).toBe(true);
    }
  });

  it('refuses an answer that is too large', async () => {
    const huge = JSON.stringify({
      models: [{ name: 'big', size: 1, filler: 'x'.repeat(5 * 1024 * 1024) }],
    });
    mock.tags = huge;
    const result = await service().catalog();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response');
    }
  });

  it('keeps a secret out of the message of the user interface', async () => {
    mock.status = 500;
    mock.tags = JSON.stringify({
      error: 'api_key=sk-abcdefgh12345678 is not valid',
    });
    const result = await service().catalog();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('sk-abcdefgh12345678');
      expect(result.error.message).toContain('[redacted]');
    }
  });

  it('throttles the progress updates of a download', async () => {
    const lines = [];
    for (let index = 0; index < 60; index += 1) {
      lines.push(
        `{"status":"pulling x","total":1000,"completed":${index * 10}}\n`,
      );
    }
    mock.pull = lines.join('');
    const events: LocalDownloadProgress[] = [];
    const downloadService = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      onProgress: (progress) => events.push(progress),
    });
    await downloadService.pull('model-a', true);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !events.some((event) => event.done)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const updates = events.filter((event) => !event.done);
    // Far fewer updates than lines: the panel must stay responsive.
    expect(updates.length).toBeLessThan(20);
    expect(events[events.length - 1]?.state).toBe('success');
  });

  it('gives the agent no tool that manages the models', () => {
    const names = AGENT_TOOLS.map((tool) => tool.name.toLowerCase());
    for (const forbidden of [
      'pull',
      'download',
      'delete_model',
      'unload',
      'install_model',
      'model',
    ]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
