/**
 * Shared helpers for the pseudo-terminals and the process trees
 * (spec §6.1, §19.6).
 *
 * The terminal sessions and the task runner both start a shell and both
 * have to be able to terminate the whole process tree of that shell — a
 * task usually starts other processes (a bundler, a test runner), and they
 * must not survive the "Stop" button.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/** Minimal shape of the node-pty API we rely on (the module is NAPI). */
export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): { dispose(): void };
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string | undefined>;
      encoding?: string | null;
    },
  ): PtyProcess;
}

/**
 * node-pty is an optional native dependency: it ships prebuilt N-API
 * binaries, but a broken installation must not take the whole app down.
 * The module is loaded lazily and a failure degrades to a clear error
 * instead of a crash.
 */
let ptyModule: PtyModule | null = null;
let ptyLoadError: string | null = null;

/**
 * Resolves `node-pty` at runtime.
 *
 * The main bundle is CommonJS, but the source is written as ES modules, so
 * `createRequire` is used to obtain a plain `require`. `node-pty` is marked
 * `external` in the Vite main build (it must stay a real file on disk).
 */
const nodeRequire = createRequire(__filename);

export function loadPty(): PtyModule | null {
  if (ptyModule !== null || ptyLoadError !== null) {
    return ptyModule;
  }
  try {
    ptyModule = nodeRequire('node-pty') as PtyModule;
  } catch (error) {
    ptyLoadError =
      error instanceof Error ? error.message : 'unknown error';
    console.error('[terminal] node-pty is unavailable:', ptyLoadError);
  }
  return ptyModule;
}

/** The reason why node-pty could not be loaded (null while it works). */
export function ptyUnavailable(): string | null {
  return ptyLoadError;
}

/**
 * Terminates a process tree on Windows and waits for it.
 *
 * `taskkill` resolves the descendants through their parent, so the tree has
 * to be terminated before the direct child is killed.
 */
export async function killWindowsTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', (error) => {
        console.error('[process] could not kill the process tree:', error);
        resolve();
      });
      killer.on('close', () => {
        resolve();
      });
    } catch (error) {
      console.error('[process] could not kill the process tree:', error);
      resolve();
    }
  });
}

/**
 * Best-effort cleanup of a process tree.
 *
 * `node-pty` kills the shell itself, but a shell can have spawned children
 * (a dev server, a watcher). On Windows the process tree is terminated with
 * `taskkill /T`; on POSIX the process group is signalled.
 *
 * The tree must be terminated BEFORE the shell itself, because `taskkill /T`
 * resolves the descendants through their parent.
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === 'win32') {
    await killWindowsTree(pid);
    return;
  }
  try {
    // Negative pid = the whole process group of the shell.
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      console.error('[process] could not kill the process group:', error);
    }
  }
}

/**
 * Removes the ANSI escape sequences from a chunk of terminal output.
 *
 * The task runner shows the output of a script in a plain text panel, so
 * the colour codes would only be noise there.
 */
export function stripAnsi(text: string): string {
  return text
    // Operating system commands (window title, colours).
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    // Control sequences.
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // Other single character escapes.
    .replace(/\u001b[@-Z\\-_]/g, '');
}
