/**
 * Tests for the download of a local model (spec §11.3, §19.2, §21).
 *
 * The tests talk to a real HTTP server (a mock Ollama), so the
 * streaming format of `/api/pull`, the progress, the cancellation and
 * the failure are verified against the actual network stack. No model
 * is ever downloaded: the mock only sends status lines.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalModelService } from '../../apps/desktop/src/main/providers/localModels/localModelService';
import { parsePullStatus } from '../../apps/desktop/src/main/providers/localModels/catalog';
import type { LocalDownloadProgress } from '../../apps/desktop/src/shared/local-model-types';

/** The behaviour of the mock server. */
interface MockBehaviour {
  /** The status lines of the answer of /api/pull. */
  lines?: string[];
  /** The delay between two lines (milliseconds). */
  lineDelayMs?: number;
  /** The status of the answer. */
  status?: number;
  /** The body of the answer (it wins over the lines). */
  body?: string;
  /** True when the stream is cut in the middle. */
  cutStream?: boolean;
}

/** A mock of the Ollama HTTP API. */
class MockOllama {
  private server: Server | null = null;
  private behaviour: MockBehaviour = {};
  /** The requests the server received. */
  readonly requests: { method: string; url: string; body: string }[] = [];
  /** True when the connection of a pull was closed by the server. */
  cut = false;

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
        if (!url.startsWith('/api/pull')) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ models: [] }));
          return;
        }
        const behaviour = this.behaviour;
        if (behaviour.status !== undefined && behaviour.status !== 200) {
          response.writeHead(behaviour.status, {
            'content-type': 'application/json',
          });
          response.end(behaviour.body ?? '{"error":"pull failed"}');
          return;
        }
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        if (behaviour.body !== undefined) {
          response.end(behaviour.body);
          return;
        }
        const lines = behaviour.lines ?? ['{"status":"success"}\n'];
        let index = 0;
        const writeNext = (): void => {
          if (index >= lines.length) {
            if (behaviour.cutStream === true) {
              this.cut = true;
              response.destroy();
              return;
            }
            response.end();
            return;
          }
          response.write(lines[index] ?? '');
          index += 1;
          setTimeout(writeNext, behaviour.lineDelayMs ?? 5);
        };
        writeNext();
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

/** Waits until the condition is true (or the time is up). */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
}

describe('the parser of the status of a download', () => {
  it('reads a status line', () => {
    const status = parsePullStatus(
      '{"status":"pulling abc","digest":"abc","total":1000,"completed":250}',
    );
    expect(status?.status).toBe('pulling abc');
    expect(status?.digest).toBe('abc');
    expect(status?.total).toBe(1000);
    expect(status?.completed).toBe(250);
  });

  it('ignores a line that is not JSON', () => {
    expect(parsePullStatus('not json')).toBeNull();
    expect(parsePullStatus('')).toBeNull();
    expect(parsePullStatus('{"other":1}')).toBeNull();
  });

  it('reads an error of Ollama', () => {
    const status = parsePullStatus('{"error":"model not found"}');
    expect(status?.error).toBe('model not found');
  });
});

describe('the download of a local model', () => {
  let mock: MockOllama;
  let baseUrl: string;

  beforeEach(async () => {
    mock = new MockOllama();
    baseUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const service = (
    onProgress?: (progress: LocalDownloadProgress) => void,
  ): LocalModelService =>
    new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      onProgress,
    });

  it('reports the progress and ends with success', async () => {
    mock.respondWith({
      lines: [
        '{"status":"pulling manifest"}\n',
        '{"status":"pulling abc","total":1000,"completed":250}\n',
        '{"status":"pulling abc","total":1000,"completed":1000}\n',
        '{"status":"verifying sha256 digest"}\n',
        '{"status":"success"}\n',
      ],
      lineDelayMs: 10,
    });
    const events: LocalDownloadProgress[] = [];
    const result = await service((progress) => events.push(progress)).pull(
      'qwen2.5:7b',
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.downloadId).toMatch(/^pull-[a-f0-9]{16}$/);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('success');
    expect(last?.done).toBe(true);
    expect(events[0]?.state).toBe('starting');
    // The request only carries the name of the model.
    const pull = mock.requests.find((request) => request.url === '/api/pull');
    expect(JSON.parse(pull?.body ?? '{}')).toEqual({
      model: 'qwen2.5:7b',
      stream: true,
    });
  });

  it('refuses a download that the user did not confirm', async () => {
    const result = await service().pull('qwen2.5:7b', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not confirmed');
    }
    expect(
      mock.requests.find((request) => request.url === '/api/pull'),
    ).toBeUndefined();
  });

  it('refuses a name that is not a model name', async () => {
    const result = await service().pull('http://example.com/model', true);
    expect(result.ok).toBe(false);
    expect(
      mock.requests.find((request) => request.url === '/api/pull'),
    ).toBeUndefined();
  });

  it('runs only one download at the same time', async () => {
    mock.respondWith({
      lines: ['{"status":"pulling abc","total":100,"completed":1}\n'],
      lineDelayMs: 50,
    });
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
    });
    const first = await service.pull('model-a', true);
    expect(first.ok).toBe(true);
    const second = await service.pull('model-b', true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('busy');
    }
  });

  it('stops a running download', async () => {
    mock.respondWith({
      lines: [
        '{"status":"pulling abc","total":100,"completed":1}\n',
        '{"status":"pulling abc","total":100,"completed":2}\n',
        '{"status":"pulling abc","total":100,"completed":3}\n',
      ],
      lineDelayMs: 200,
    });
    const events: LocalDownloadProgress[] = [];
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      onProgress: (progress) => events.push(progress),
    });
    const started = await service.pull('model-a', true);
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const cancelled = await service.cancelPull(started.value.downloadId);
    expect(cancelled.ok).toBe(true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('cancelled');
  });

  it('stops a download that already streams', async () => {
    // The cancel comes after the first status line: the answer of Ollama
    // is already open, so the abort has to reach the running stream.
    mock.respondWith({
      lines: [
        '{"status":"pulling abc","total":100,"completed":1}\n',
        '{"status":"pulling abc","total":100,"completed":2}\n',
        '{"status":"pulling abc","total":100,"completed":3}\n',
        '{"status":"pulling abc","total":100,"completed":4}\n',
      ],
      lineDelayMs: 300,
    });
    const events: LocalDownloadProgress[] = [];
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      onProgress: (progress) => events.push(progress),
    });
    const started = await service.pull('model-a', true);
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    // The stream is open now.
    const streaming = await waitFor(
      () => events.some((event) => event.state === 'downloading'),
    );
    expect(streaming).toBe(true);
    const cancelled = await service.cancelPull(started.value.downloadId);
    expect(cancelled.ok).toBe(true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('cancelled');
    // The stream really ended: no status line arrives any more.
    const before = events.length;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(events.length).toBe(before);
  });

  it('cannot cancel a download that does not exist', async () => {
    const result = await service().cancelPull('pull-does-not-exist');
    expect(result.ok).toBe(false);
  });

  it('reports a model that Ollama does not know', async () => {
    mock.respondWith({
      body: '{"error":"pull model manifest: file does not exist"}\n',
    });
    const events: LocalDownloadProgress[] = [];
    await service((progress) => events.push(progress)).pull('nope', true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('error');
    expect(last?.errorCode).toBe('unknown-model');
  });

  it('reports a server that refuses the download', async () => {
    mock.respondWith({ status: 500, body: '{"error":"server exploded"}' });
    const events: LocalDownloadProgress[] = [];
    await service((progress) => events.push(progress)).pull('model-a', true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('error');
    expect(last?.message).toContain('server exploded');
  });

  it('reports a connection that fails in the middle', async () => {
    mock.respondWith({
      lines: ['{"status":"pulling abc","total":100,"completed":1}\n'],
      lineDelayMs: 10,
      cutStream: true,
    });
    const events: LocalDownloadProgress[] = [];
    await service((progress) => events.push(progress)).pull('model-a', true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    const last = events[events.length - 1];
    expect(last?.state).toBe('error');
    expect(last?.errorCode).toBe('network');
  });

  it('reports a service that does not run', async () => {
    const events: LocalDownloadProgress[] = [];
    const offline = new LocalModelService({
      target: async () => ({
        baseUrl: 'http://127.0.0.1:1',
        remoteConfirmed: false,
      }),
      onProgress: (progress) => events.push(progress),
    });
    await offline.pull('model-a', true);
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    expect(events[events.length - 1]?.state).toBe('error');
  });

  it('stops every download when the application quits', async () => {
    mock.respondWith({
      lines: ['{"status":"pulling abc","total":100,"completed":1}\n'],
      lineDelayMs: 200,
    });
    const events: LocalDownloadProgress[] = [];
    const service = new LocalModelService({
      target: async () => ({ baseUrl, remoteConfirmed: false }),
      onProgress: (progress) => events.push(progress),
    });
    await service.pull('model-a', true);
    service.cancelAll();
    const finished = await waitFor(() => events.some((event) => event.done));
    expect(finished).toBe(true);
    expect(events[events.length - 1]?.state).toBe('cancelled');
  });
});
