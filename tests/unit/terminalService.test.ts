/**
 * Terminal service tests (spec §6.1, §17, §19).
 *
 * The real service is exercised against a real workspace directory. The
 * `node-pty` module is NOT mocked: the tests spawn actual shells, so the
 * lifecycle, the working directory and the process cleanup are verified
 * for real.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TerminalService,
  resolveDefaultShell,
} from '../../apps/desktop/src/main/services/terminalService';

let root = '';
let service: TerminalService | null = null;
const outputs = new Map<string, string>();
const exits: { sessionId: string; exitCode: number }[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-terminal-'));
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await writeFile(path.join(root, 'sub', 'file.txt'), 'hello', 'utf8');
  outputs.clear();
  exits.length = 0;
  service = new TerminalService({
    getRoot: () => root,
    onData: (sessionId, data) => {
      outputs.set(sessionId, `${outputs.get(sessionId) ?? ''}${data}`);
    },
    onExit: (exit) => {
      exits.push({ sessionId: exit.sessionId, exitCode: exit.exitCode });
    },
  });
});

afterEach(async () => {
  service?.killAll();
  service = null;
  // The shell keeps the working directory open until it has exited, so the
  // removal is retried until the handle is released.
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
});

/** Waits until the predicate is satisfied or the timeout elapses. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

describe('default shell', () => {
  it('uses PowerShell on Windows', () => {
    const shell = resolveDefaultShell('win32', {});
    expect(shell.file).toBe('powershell.exe');
    expect(shell.name).toBe('PowerShell');
  });

  it('uses the user shell on POSIX systems', () => {
    const shell = resolveDefaultShell('linux', { SHELL: '/bin/zsh' });
    expect(shell.file).toBe('/bin/zsh');
    expect(shell.name).toBe('zsh');
  });

  it('falls back to bash when POSIX has no SHELL variable', () => {
    const shell = resolveDefaultShell('darwin', {});
    expect(shell.file).toBe('/bin/bash');
  });
});

describe('terminal lifecycle', () => {
  it('refuses to start without a workspace', async () => {
    const withoutWorkspace = new TerminalService({
      getRoot: () => null,
      onData: () => undefined,
      onExit: () => undefined,
    });
    const result = await withoutWorkspace.create();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_WORKSPACE');
    }
  });

  it('starts a session in the workspace root', async () => {
    const result = await service?.create();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.cwd).toBe(root);
      expect(result.value.id.length).toBeGreaterThan(0);
      expect(result.value.cols).toBeGreaterThan(0);
      expect(result.value.rows).toBeGreaterThan(0);
    }
    expect(service?.sessionCount).toBe(1);
  });

  it('accepts a working directory inside the workspace', async () => {
    const result = await service?.create(path.join(root, 'sub'));
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.cwd).toBe(path.join(root, 'sub'));
    }
  });

  it('rejects a working directory outside the workspace', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'nova-outside-'));
    try {
      const result = await service?.create(outside);
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.code).toBe('OUTSIDE_WORKSPACE');
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a traversal attempt in the working directory', async () => {
    const result = await service?.create(path.join(root, '..', 'escape'));
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('OUTSIDE_WORKSPACE');
    }
  });

  it('writes input to the session and returns its output', async () => {
    const created = await service?.create();
    expect(created?.ok).toBe(true);
    if (!created?.ok) {
      return;
    }
    const sessionId = created.value.id;
    // The exact echo differs per shell, so the marker is checked instead.
    service?.write(sessionId, 'echo NOVA_TERMINAL_MARKER\r');
    const received = await waitFor(() =>
      (outputs.get(sessionId) ?? '').includes('NOVA_TERMINAL_MARKER'),
    );
    expect(received).toBe(true);
  }, 20000);

  it('reports a failure for an unknown session', async () => {
    const writeResult = service?.write('does-not-exist', 'x');
    expect(writeResult?.ok).toBe(false);
    const resizeResult = service?.resize('does-not-exist', 80, 24);
    expect(resizeResult?.ok).toBe(false);
    const killResult = service?.kill('does-not-exist');
    expect(killResult?.ok).toBe(false);
  });

  it('rejects an invalid terminal size', async () => {
    const created = await service?.create();
    if (!created?.ok) {
      return;
    }
    expect(service?.resize(created.value.id, 0, 24).ok).toBe(false);
    expect(service?.resize(created.value.id, 80, 0).ok).toBe(false);
    expect(service?.resize(created.value.id, 10.5, 24).ok).toBe(false);
    expect(service?.resize(created.value.id, 100, 40).ok).toBe(true);
  });

  it('kills a session and reports the exit', async () => {
    const created = await service?.create();
    if (!created?.ok) {
      return;
    }
    const sessionId = created.value.id;
    expect(service?.kill(sessionId).ok).toBe(true);
    expect(service?.sessionCount).toBe(0);
    const reported = await waitFor(() =>
      exits.some((exit) => exit.sessionId === sessionId),
    );
    expect(reported).toBe(true);
  }, 20000);

  it('terminates every session when the workspace closes', async () => {
    await service?.create();
    await service?.create();
    expect(service?.sessionCount).toBe(2);
    service?.killAll();
    expect(service?.sessionCount).toBe(0);
  });

  it('caps the number of concurrent sessions', async () => {
    for (let index = 0; index < 8; index += 1) {
      const created = await service?.create();
      expect(created?.ok).toBe(true);
    }
    const overflow = await service?.create();
    expect(overflow?.ok).toBe(false);
    if (overflow && !overflow.ok) {
      expect(overflow.message).toContain('Too many');
    }
  });
});
