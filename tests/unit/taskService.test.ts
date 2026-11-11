/**
 * Task runner tests (spec §21, §19).
 *
 * The real service runs real child processes, so the lifecycle, the
 * cancellation and the termination of the whole process tree are verified
 * for real.
 *
 * The scripts are written as small helper files instead of inline shell
 * snippets, so the tests do not depend on the quoting rules of the
 * platform shell.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskService } from '../../apps/desktop/src/main/services/taskService';

let root = '';
let service: TaskService | null = null;
const output: { taskId: string; chunk: string }[] = [];
const statuses: { taskId: string; status: string; exitCode: number | null }[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-tasks-'));
  output.length = 0;
  statuses.length = 0;
  service = new TaskService({
    getRoot: () => root,
    onOutput: (event) => {
      output.push({ taskId: event.taskId, chunk: event.chunk });
    },
    onStatus: (event) => {
      statuses.push({
        taskId: event.taskId,
        status: event.status,
        exitCode: event.exitCode,
      });
    },
  });
});

afterEach(async () => {
  await service?.killAll();
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

/** Writes a package.json with the given scripts. */
async function writePackage(
  scripts: Record<string, string>,
): Promise<void> {
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo', private: true, scripts }),
    'utf8',
  );
}

/** Writes a helper script that the package scripts call. */
async function writeHelper(name: string, source: string): Promise<void> {
  await writeFile(path.join(root, name), source, 'utf8');
}

/** Waits until a task reached a final state. */
async function waitForStatus(
  taskId: string,
  finalStates: readonly string[],
  timeoutMs = 20000,
): Promise<{ status: string; exitCode: number | null } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = statuses
      .filter((entry) => entry.taskId === taskId)
      .filter((entry) => finalStates.includes(entry.status))
      .pop();
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe('task listing', () => {
  it('refuses to list without a workspace', async () => {
    const withoutWorkspace = new TaskService({
      getRoot: () => null,
      onOutput: () => undefined,
      onStatus: () => undefined,
    });
    const result = await withoutWorkspace.list();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_WORKSPACE');
    }
  });

  it('returns an empty list when there is no package.json', async () => {
    const result = await service?.list();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('lists the scripts of the workspace package.json', async () => {
    await writePackage({ build: 'echo build', test: 'echo test' });
    const result = await service?.list();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.map((task) => task.name)).toEqual(['build', 'test']);
      expect(result.value[0]?.command).toBe('echo build');
    }
  });

  it('ignores a malformed package.json', async () => {
    await writeFile(path.join(root, 'package.json'), '{ not json', 'utf8');
    const result = await service?.list();
    expect(result?.ok).toBe(false);
  });
});

describe('task execution', () => {
  it('refuses to run a script that does not exist', async () => {
    await writePackage({ build: 'echo build' });
    const result = await service?.run('does-not-exist');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('runs a script and reports success', async () => {
    await writeHelper('hello.js', "console.log('NOVA_TASK_HELLO');\n");
    await writePackage({ hello: 'node hello.js' });
    const started = await service?.run('hello');
    expect(started?.ok).toBe(true);
    if (!started?.ok) {
      return;
    }
    const taskId = started.value.taskId;
    const final = await waitForStatus(taskId, ['success', 'failed']);
    expect(final?.status).toBe('success');
    const text = output
      .filter((entry) => entry.taskId === taskId)
      .map((entry) => entry.chunk)
      .join('');
    expect(text).toContain('NOVA_TASK_HELLO');
  }, 30000);

  it('reports a failing script', async () => {
    await writeHelper('broken.js', 'process.exit(3);\n');
    await writePackage({ broken: 'node broken.js' });
    const started = await service?.run('broken');
    if (!started?.ok) {
      return;
    }
    const final = await waitForStatus(started.value.taskId, ['success', 'failed']);
    expect(final?.status).toBe('failed');
    expect(final?.exitCode).toBe(3);
  }, 30000);

  it('cancels a running task', async () => {
    await writeHelper(
      'slow.js',
      "console.log('NOVA_TASK_STARTED');\nsetTimeout(() => {}, 30000);\n",
    );
    await writePackage({ slow: 'node slow.js' });
    const started = await service?.run('slow');
    if (!started?.ok) {
      return;
    }
    const taskId = started.value.taskId;
    // Wait until the task is really running before it is stopped.
    const running = await waitForStatus(taskId, ['running']);
    expect(running).not.toBeNull();
    const cancelled = await service?.cancel(taskId);
    expect(cancelled?.ok).toBe(true);
    const final = await waitForStatus(taskId, ['cancelled', 'success', 'failed']);
    expect(final?.status).toBe('cancelled');
    expect(service?.runningCount).toBe(0);
  }, 30000);

  it('refuses to cancel an unknown task', async () => {
    const result = await service?.cancel('unknown');
    expect(result?.ok).toBe(false);
  });

  it('terminates every running task at once', async () => {
    await writeHelper('slow.js', 'setTimeout(() => {}, 30000);\n');
    await writePackage({ slow: 'node slow.js' });
    const started = await service?.run('slow');
    expect(started?.ok).toBe(true);
    await waitForStatus(started?.ok === true ? started.value.taskId : '', ['running']);
    expect(service?.runningCount).toBe(1);
    await service?.killAll();
    expect(service?.runningCount).toBe(0);
  }, 30000);
});

describe('task process tree', () => {
  it('kills the children of a task when it is stopped', async () => {
    // The script starts a child process that writes a marker file after a
    // delay. Stopping the task must prevent the marker from appearing.
    const marker = path.join(root, 'child-marker.txt');
    await writeHelper(
      'child.js',
      [
        "const fs = require('node:fs');",
        `setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'x'), 3000);`,
      ].join('\n'),
    );
    await writeHelper(
      'parent.js',
      [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['child.js'], { stdio: 'ignore' });",
        'console.log("NOVA_PARENT_STARTED");',
        'setTimeout(() => {}, 30000);',
      ].join('\n'),
    );
    await writePackage({ parent: 'node parent.js' });

    const started = await service?.run('parent');
    if (!started?.ok) {
      return;
    }
    const taskId = started.value.taskId;
    // Wait until the parent reported that it is running.
    await waitForStatus(taskId, ['running']);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    service?.cancel(taskId);
    const final = await waitForStatus(taskId, ['cancelled', 'success', 'failed']);
    expect(final?.status).toBe('cancelled');
    // Wait past the point where the child would have written the marker.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    let markerExists = true;
    try {
      await readFile(marker, 'utf8');
    } catch {
      markerExists = false;
    }
    expect(markerExists).toBe(false);
  }, 40000);
});
