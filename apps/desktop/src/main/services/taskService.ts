/**
 * Build / test task runner (spec §21).
 *
 * Tasks are the scripts of the *active workspace's* `package.json`. Only
 * those scripts can be started — the renderer can never pass an arbitrary
 * command line, and no script is ever auto-started.
 *
 * Security rules:
 *  - The `package.json` is read through `resolveInWorkspace`, so it always
 *    belongs to the active workspace.
 *  - A script is started by name; the command comes from the file, never
 *    from the renderer.
 *  - The script runs with `cwd` set to the workspace root and with a
 *    trimmed environment.
 *  - "Stop" terminates the whole process tree, not just the direct child.
 *
 * The script runs in a pseudo-terminal (like an integrated terminal), so a
 * build tool behaves exactly as it does in a terminal. The pseudo-terminal
 * is started by the native module and therefore does not belong to the
 * process tree of the application: if the application dies unexpectedly, the
 * watchdog can still terminate the script together with its children.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FsResult,
  TaskDefinition,
  TaskStatus,
} from '../../shared/ipc-types';
import { resolveInWorkspace } from './pathSecurity';
import {
  killProcessTree,
  loadPty,
  ptyUnavailable,
  stripAnsi,
  type PtyProcess,
} from './processTree';
import { fsFail, fsOk } from './results';

/** Maximum number of concurrent tasks. */
const MAX_TASKS = 4;
/** Maximum size of the workspace `package.json`. */
const MAX_PACKAGE_JSON_BYTES = 4 * 1024 * 1024;
/** Maximum number of captured output characters kept per task. */
const MAX_TASK_OUTPUT_CHARS = 256 * 1024;
/** Maximum length of a task name accepted from the renderer. */
const MAX_TASK_NAME_LENGTH = 128;
/** The size of the pseudo-terminal of a task. */
const TASK_COLS = 120;
const TASK_ROWS = 30;

/** A running task. */
interface RunningTask {
  id: string;
  name: string;
  /** The pseudo-terminal of the task. */
  child: PtyProcess;
  /** Captured output (bounded). */
  output: string;
  /** True when the task was cancelled by the user. */
  cancelled: boolean;
}

export interface TaskServiceOptions {
  /** Returns the canonical root of the active workspace, or null. */
  getRoot: () => string | null;
  /** Called for every output chunk of every task. */
  onOutput: (output: { taskId: string; chunk: string }) => void;
  /** Called when a task changes its lifecycle state. */
  onStatus: (status: {
    taskId: string;
    status: TaskStatus;
    exitCode: number | null;
  }) => void;
  /**
   * Called when a task process starts, so it can be terminated if the
   * application dies unexpectedly.
   */
  onProcessStart?: (pid: number) => void;
  /** Called when a task process is gone. */
  onProcessEnd?: (pid: number) => void;
}

export class TaskService {
  private readonly getRoot: () => string | null;
  private readonly onOutput: (output: {
    taskId: string;
    chunk: string;
  }) => void;
  private readonly onStatus: (status: {
    taskId: string;
    status: TaskStatus;
    exitCode: number | null;
  }) => void;
  private readonly onProcessStart: ((pid: number) => void) | undefined;
  private readonly onProcessEnd: ((pid: number) => void) | undefined;
  private readonly tasks = new Map<string, RunningTask>();
  /** The process ids of the tasks (kept after the task has ended). */
  private readonly processIds = new Map<string, number>();
  private nextTaskId = 1;

  constructor(options: TaskServiceOptions) {
    this.getRoot = options.getRoot;
    this.onOutput = options.onOutput;
    this.onStatus = options.onStatus;
    this.onProcessStart = options.onProcessStart;
    this.onProcessEnd = options.onProcessEnd;
  }

  /** Number of running tasks (diagnostics / tests). */
  get runningCount(): number {
    return this.tasks.size;
  }

  /** Lists the scripts of the workspace `package.json`. */
  async list(): Promise<FsResult<TaskDefinition[]>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before running tasks');
    }
    const packageJson = await this.readPackageJson(root);
    if (!packageJson.ok) {
      return fsFail(packageJson.code, packageJson.message);
    }
    const scripts = packageJson.value.scripts;
    if (scripts === null || typeof scripts !== 'object') {
      return fsOk<TaskDefinition[]>([]);
    }
    const definitions: TaskDefinition[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') {
        continue;
      }
      definitions.push({ name, command });
    }
    definitions.sort((a, b) => a.name.localeCompare(b.name));
    return fsOk(definitions);
  }

  /** Starts the named script. */
  async run(name: string): Promise<FsResult<{ taskId: string }>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before running tasks');
    }
    if (name.length === 0 || name.length > MAX_TASK_NAME_LENGTH) {
      return fsFail('INVALID_PATH', 'Invalid task name');
    }
    if (this.tasks.size >= MAX_TASKS) {
      return fsFail('UNKNOWN', `Too many running tasks (limit ${MAX_TASKS})`);
    }

    const packageJson = await this.readPackageJson(root);
    if (!packageJson.ok) {
      return fsFail(packageJson.code, packageJson.message);
    }
    const scripts = packageJson.value.scripts;
    const command =
      scripts !== null && typeof scripts === 'object'
        ? scripts[name]
        : undefined;
    if (typeof command !== 'string') {
      return fsFail('NOT_FOUND', `The script "${name}" does not exist`);
    }

    const pty = loadPty();
    if (pty === null) {
      return fsFail(
        'UNKNOWN',
        `The task backend is unavailable: ${ptyUnavailable() ?? 'unknown error'}`,
      );
    }

    const taskId = `task-${this.nextTaskId}`;
    this.nextTaskId += 1;

    // The script runs in the command interpreter of the platform, exactly
    // as npm would run it.
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const args = isWindows
      ? ['/d', '/s', '/c', command]
      : ['-c', command];

    let child: PtyProcess;
    try {
      child = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: TASK_COLS,
        rows: TASK_ROWS,
        cwd: root,
        env: trimmedEnvironment(root),
        encoding: 'utf8',
      });
    } catch (error) {
      console.error('[task] could not start the script:', error);
      return fsFail('UNKNOWN', 'The task could not be started');
    }

    const task: RunningTask = {
      id: taskId,
      name,
      child,
      output: '',
      cancelled: false,
    };
    this.tasks.set(taskId, task);
    this.processIds.set(taskId, child.pid);
    this.onProcessStart?.(child.pid);

    const appendOutput = (chunk: string): void => {
      // The pseudo-terminal reports the escape sequences of the program;
      // the plain text panel of the tasks does not need them.
      const text = stripAnsi(chunk).replace(/\r\n/g, '\n');
      if (text.length === 0) {
        return;
      }
      if (task.output.length < MAX_TASK_OUTPUT_CHARS) {
        task.output = `${task.output}${text}`.slice(0, MAX_TASK_OUTPUT_CHARS);
      }
      this.onOutput({ taskId, chunk: text });
    };

    child.onData((data: string) => appendOutput(data));

    child.onExit((event) => {
      if (task.cancelled) {
        this.finish(taskId, 'cancelled', null);
        return;
      }
      this.finish(taskId, event.exitCode === 0 ? 'success' : 'failed', event.exitCode);
    });

    this.onStatus({ taskId, status: 'running', exitCode: null });
    return fsOk<{ taskId: string }>({ taskId });
  }

  /** Cancels a running task and kills its process tree. */
  async cancel(taskId: string): Promise<FsResult<void>> {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      return fsFail('NOT_FOUND', 'The task is no longer running');
    }
    task.cancelled = true;
    // The tree is terminated first; the task is only reported as cancelled
    // afterwards, so a "cancelled" status really means "no child is left".
    await this.killTree(task);
    this.finish(taskId, 'cancelled', null);
    return fsOk<void>(undefined);
  }

  /**
   * Cancels every running task (workspace closed, app quitting).
   * Safe to call more than once.
   */
  async killAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [taskId, task] of [...this.tasks.entries()]) {
      task.cancelled = true;
      pending.push(
        this.killTree(task).then(() => {
          this.finish(taskId, 'cancelled', null);
        }),
      );
    }
    await Promise.all(pending);
  }

  /**
   * Terminates the task's whole process tree.
   *
   * A task usually starts other processes (a bundler, a test runner); they
   * must not survive the "Stop" button.
   *
   * The tree is terminated BEFORE the direct child is killed: on Windows
   * `taskkill /T` resolves the descendants through the parent, so killing
   * the parent first would detach the children and leave them running.
   */
  private async killTree(task: RunningTask): Promise<void> {
    await killProcessTree(task.child.pid);
    try {
      task.child.kill();
    } catch {
      // The process may already be gone.
    }
  }

  /** Removes a task and reports its final status. */
  private finish(
    taskId: string,
    status: TaskStatus,
    exitCode: number | null,
  ): void {
    const pid = this.processIds.get(taskId);
    this.processIds.delete(taskId);
    if (pid !== undefined) {
      this.onProcessEnd?.(pid);
    }
    if (!this.tasks.has(taskId)) {
      return;
    }
    this.tasks.delete(taskId);
    this.onStatus({ taskId, status, exitCode });
  }

  /**
   * Reads and parses the workspace `package.json`.
   *
   * The path is validated against the workspace before it is read. A
   * workspace without a `package.json` simply has no scripts — that is an
   * empty list, not an error.
   */
  private async readPackageJson(
    root: string,
  ): Promise<
    FsResult<{ scripts: Record<string, unknown> | null }>
  > {
    const resolved = await resolveInWorkspace(
      root,
      path.join(root, 'package.json'),
      { allowRoot: false, mustExist: false },
    );
    if (!resolved.ok) {
      return fsFail(resolved.code, 'The workspace has no package.json');
    }

    let stat;
    try {
      stat = await fs.stat(resolved.value);
    } catch {
      // No package.json — the workspace simply has no scripts.
      return fsOk({ scripts: null });
    }
    if (!stat.isFile() || stat.size > MAX_PACKAGE_JSON_BYTES) {
      return fsFail('FILE_TOO_LARGE', 'The package.json is too large to read');
    }

    let raw: string;
    try {
      raw = await fs.readFile(resolved.value, 'utf8');
    } catch {
      return fsFail('NOT_FOUND', 'The package.json could not be read');
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return fsOk({ scripts: null });
      }
      const scripts = (parsed as { scripts?: unknown }).scripts;
      if (typeof scripts !== 'object' || scripts === null) {
        return fsOk({ scripts: null });
      }
      return fsOk({ scripts: scripts as Record<string, unknown> });
    } catch {
      return fsFail('UNKNOWN', 'The package.json is not valid JSON');
    }
  }
}

/**
 * Builds the environment for a task.
 *
 * The workspace `node_modules/.bin` directory is prepended to `PATH` so
 * that `npm run`-style scripts can find their local binaries.
 */
export function trimmedEnvironment(root: string): NodeJS.ProcessEnv {
  const separator = process.platform === 'win32' ? ';' : ':';
  const binDirectory = path.join(root, 'node_modules', '.bin');
  const pathValue = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: `${binDirectory}${separator}${pathValue}`,
    FORCE_COLOR: '1',
    CI: '1',
  };
}
