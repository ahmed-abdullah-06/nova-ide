/**
 * Git integration service (spec §16, §19.2).
 *
 * Every git invocation goes through {@link runGit}, which:
 *  - uses an argument array (never a shell string), so no value coming from
 *    the renderer can ever be interpreted as a shell metacharacter,
 *  - always sets `cwd` to the validated workspace root,
 *  - prefixes every path argument with `--` so a path that looks like an
 *    option (`-x`, `--upload-pack=…`) cannot be mistaken for one,
 *  - enforces a timeout and an output cap.
 *
 * Only the read-only and the explicitly allowed mutating commands are
 * exposed. `push`, `pull`, `fetch`, `reset --hard` and friends are not
 * implemented in Milestone 3.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  FsResult,
  GitBranch,
  GitFileChange,
  GitStatus,
} from '../../shared/ipc-types';
import { resolveInWorkspace } from './pathSecurity';
import { fsFail, fsOk } from './results';

/** Maximum number of bytes captured from a git command. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Timeout for a single git invocation. */
const GIT_TIMEOUT_MS = 30_000;
/** Maximum length of a commit message. */
const MAX_COMMIT_MESSAGE_LENGTH = 4096;
/** Maximum length of a branch name. */
const MAX_BRANCH_NAME_LENGTH = 255;

export interface GitServiceOptions {
  /** Returns the canonical root of the active workspace, or null. */
  getRoot: () => string | null;
}

/** Result of a single git invocation. */
interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the command could not be started (git is not installed). */
  spawnFailed: boolean;
}

/**
 * The tail of the queue of the git commands.
 *
 * Git itself is not safe for concurrent access to the same repository:
 * two commands that refresh the index at the same time wait for each
 * other (and the user would see a status that takes seconds). Every
 * command therefore runs alone — they are fast enough on their own.
 */
let commandQueue: Promise<unknown> = Promise.resolve();

/**
 * Puts a command into the queue of the git commands.
 *
 * @param command The command to run.
 * @returns The result of the command.
 */
function enqueue<T>(command: () => Promise<T>): Promise<T> {
  const run = commandQueue.then(command);
  // A failed command must not block the queue.
  commandQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Runs git with the given arguments.
 *
 * The environment is trimmed so git never opens an interactive prompt
 * (a hanging git would block the whole application).
 */
function runGit(
  cwd: string,
  args: string[],
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<GitResult> {
  return enqueue(() => executeGit(cwd, args, timeoutMs));
}

/**
 * Runs a single git command.
 */
function executeGit(
  cwd: string,
  args: string[],
  timeoutMs: number,
): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let truncated = false;

    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_CONFIG_NOSYSTEM: '1',
        LC_ALL: 'C',
      },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: error.message,
        spawnFailed: true,
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: truncated ? `${stdout}\n[output truncated]` : stdout,
        stderr: truncated ? `${stderr}\n[output truncated]` : stderr,
        spawnFailed: false,
      });
    });
  });
}

export class GitService {
  private readonly getRoot: () => string | null;

  constructor(options: GitServiceOptions) {
    this.getRoot = options.getRoot;
  }

  /** Reads the repository status of the active workspace. */
  async status(): Promise<FsResult<GitStatus>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }

    const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
    if (inside.spawnFailed) {
      return fsFail(
        'UNKNOWN',
        'Git is not installed or not available on the PATH',
      );
    }
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      // Not a repository — a normal state, not an error.
      return fsOk<GitStatus>({
        isRepository: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
      });
    }

    const branch = await this.readBranch(root);
    const changes = await this.readChanges(root);

    return fsOk<GitStatus>({
      isRepository: true,
      branch: branch.branch,
      upstream: branch.upstream,
      ahead: branch.ahead,
      behind: branch.behind,
      staged: changes.staged,
      unstaged: changes.unstaged,
      untracked: changes.untracked,
    });
  }

  /** Stages a path. */
  async stage(targetPath: string): Promise<FsResult<GitStatus>> {
    return this.runMutation(targetPath, ['add', '--']);
  }

  /** Unstages a path (keeps the working tree untouched). */
  async unstage(targetPath: string): Promise<FsResult<GitStatus>> {
    return this.runMutation(targetPath, ['restore', '--staged', '--']);
  }

  /**
   * Discards local changes of a path.
   *
   * The renderer must confirm before calling this — discarding work is not
   * reversible (spec §16: "The AI agent must not automatically commit or
   * push changes without appropriate user authorization").
   */
  async discard(targetPath: string): Promise<FsResult<GitStatus>> {
    return this.runMutation(targetPath, ['checkout', '--']);
  }

  /** Creates a commit from the staged changes. */
  async commit(message: string): Promise<FsResult<GitStatus>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return fsFail('INVALID_PATH', 'The commit message is empty');
    }
    if (trimmed.length > MAX_COMMIT_MESSAGE_LENGTH) {
      return fsFail('INVALID_PATH', 'The commit message is too long');
    }

    // `-F -` reads the message from stdin, so no message content can be
    // mistaken for a git option.
    const result = await runGitWithInput(root, ['commit', '-F', '-'], trimmed);

    if (result.spawnFailed) {
      return fsFail('UNKNOWN', 'Git is not installed or not available on the PATH');
    }
    if (result.code !== 0) {
      return fsFail(
        'UNKNOWN',
        result.stderr.trim() || 'The commit failed',
      );
    }
    return this.status();
  }

  /** Returns the textual diff of a path. */
  async diff(
    targetPath: string,
    staged: boolean,
  ): Promise<FsResult<{ diff: string }>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }
    const relative = await this.resolveRelative(root, targetPath);
    if (!relative.ok) {
      return fsFail(relative.code, relative.message);
    }

    const args = staged
      ? ['diff', '--cached', '--', relative.value]
      : ['diff', '--', relative.value];
    const result = await runGit(root, args);
    if (result.spawnFailed) {
      return fsFail('UNKNOWN', 'Git is not installed or not available on the PATH');
    }
    if (result.code !== 0) {
      return fsFail('UNKNOWN', result.stderr.trim() || 'The diff failed');
    }
    return fsOk({ diff: result.stdout });
  }

  /**
   * Lists the local branches of the repository.
   *
   * Only local branches are listed: a remote branch is not checked out
   * directly, it is created from a remote-tracking branch first.
   */
  async branches(): Promise<FsResult<GitBranch[]>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }
    const result = await runGit(root, [
      'for-each-ref',
      '--format=%(refname:short)%09%(HEAD)',
      'refs/heads',
    ]);
    if (result.spawnFailed) {
      return fsFail('UNKNOWN', 'Git is not installed or not available on the PATH');
    }
    if (result.code !== 0) {
      return fsOk<GitBranch[]>([]);
    }

    const branches: GitBranch[] = [];
    for (const line of result.stdout.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      const [name, marker] = line.split('\t');
      if (name === undefined || name.length === 0) {
        continue;
      }
      branches.push({ name, current: marker === '*' });
    }
    return fsOk(branches);
  }

  /**
   * Checks out another local branch.
   *
   * The branch must be one of the local branches of the repository: the
   * name is matched against the list, so a value from the renderer can
   * never be interpreted as a git option.
   */
  async switchBranch(name: string): Promise<FsResult<GitStatus>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }
    if (name.length === 0 || name.length > MAX_BRANCH_NAME_LENGTH) {
      return fsFail('INVALID_PATH', 'Invalid branch name');
    }
    // A name that starts with a dash could be an option of git.
    if (name.startsWith('-')) {
      return fsFail('INVALID_PATH', 'Invalid branch name');
    }

    const known = await this.branches();
    if (!known.ok) {
      return fsFail(known.code, known.message);
    }
    const branch = known.value.find((entry) => entry.name === name);
    if (branch === undefined) {
      return fsFail('NOT_FOUND', `The branch "${name}" does not exist`);
    }
    if (branch.current) {
      return this.status();
    }

    const result = await runGit(root, ['switch', name]);
    if (result.spawnFailed) {
      return fsFail('UNKNOWN', 'Git is not installed or not available on the PATH');
    }
    if (result.code !== 0) {
      return fsFail(
        'UNKNOWN',
        result.stderr.trim() || 'The branch could not be checked out',
      );
    }
    return this.status();
  }

  /**
   * Runs a mutating git command for one path and returns the new status.
   *
   * The path is resolved inside the workspace first and converted to a
   * repository-relative path, then passed after `--`.
   */
  private async runMutation(
    targetPath: string,
    args: string[],
  ): Promise<FsResult<GitStatus>> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before using Git');
    }
    const relative = await this.resolveRelative(root, targetPath);
    if (!relative.ok) {
      return fsFail(relative.code, relative.message);
    }

    const result = await runGit(root, [...args, relative.value]);
    if (result.spawnFailed) {
      return fsFail('UNKNOWN', 'Git is not installed or not available on the PATH');
    }
    if (result.code !== 0) {
      return fsFail('UNKNOWN', result.stderr.trim() || 'The Git command failed');
    }
    return this.status();
  }

  /**
   * Converts a renderer-supplied path into a repository-relative path.
   *
   * The path is canonicalised inside the workspace first, so traversal and
   * symlink escapes are rejected before git ever sees it.
   */
  private async resolveRelative(
    root: string,
    targetPath: string,
  ): Promise<FsResult<string>> {
    const resolved = await resolveInWorkspace(root, targetPath, {
      allowRoot: false,
      mustExist: true,
    });
    if (!resolved.ok) {
      return fsFail(resolved.code, 'The path is outside the workspace');
    }
    const relative = path
      .relative(root, resolved.value)
      .split('\\')
      .join('/');
    if (relative.length === 0 || relative.startsWith('..')) {
      return fsFail('OUTSIDE_WORKSPACE', 'The path is outside the workspace');
    }
    return fsOk(relative);
  }

  /** Reads the current branch, its upstream and the ahead/behind counters. */
  private async readBranch(root: string): Promise<{
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
  }> {
    const result = await runGit(root, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      'HEAD',
    ]);
    const branch = result.code === 0 ? result.stdout.trim() : '';
    if (branch === '' || branch === 'HEAD') {
      return { branch: null, upstream: null, ahead: 0, behind: 0 };
    }

    const counts = await runGit(root, [
      'rev-list',
      '--left-right',
      '--count',
      `${branch}...@{upstream}`,
    ]);
    let ahead = 0;
    let behind = 0;
    let upstream: string | null = null;
    if (counts.code === 0) {
      const parts = counts.stdout.trim().split(/\s+/);
      ahead = Number.parseInt(parts[0] ?? '0', 10) || 0;
      behind = Number.parseInt(parts[1] ?? '0', 10) || 0;
      upstream = `${branch}...@{upstream}`;
    }
    return { branch, upstream, ahead, behind };
  }

  /**
   * Reads the changed files.
   *
   * `git status --porcelain=v1 -z` is used: the `-z` format is
   * NUL-separated and therefore unambiguous for file names that contain
   * spaces or quotes.
   */
  private async readChanges(root: string): Promise<{
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: GitFileChange[];
  }> {
    const result = await runGit(root, ['status', '--porcelain=v1', '-z']);
    if (result.code !== 0) {
      return { staged: [], unstaged: [], untracked: [] };
    }

    const staged: GitFileChange[] = [];
    const unstaged: GitFileChange[] = [];
    const untracked: GitFileChange[] = [];

    const entries = result.stdout.split('\0');
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined || entry.length < 4) {
        continue;
      }
      const indexStatus = entry[0] as string;
      const worktreeStatus = entry[1] as string;
      const relativePath = entry.slice(3);

      // Renames are reported as two NUL-separated entries; the second one
      // is the original path and has to be skipped.
      if (indexStatus === 'R' || indexStatus === 'C') {
        index += 1;
      }

      const absolute = path.join(root, relativePath);
      const change: GitFileChange = {
        path: absolute,
        relativePath,
        staged: indexStatus !== ' ' && indexStatus !== '?',
        status: indexStatus === '?' ? '?' : worktreeStatus,
      };

      if (indexStatus === '?' && worktreeStatus === '?') {
        untracked.push(change);
        continue;
      }
      if (change.staged) {
        staged.push(change);
      }
      if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
        unstaged.push(change);
      }
    }

    return { staged, unstaged, untracked };
  }
}

/**
 * Runs git and writes the given text to its stdin.
 *
 * Used for `git commit -F -`, where the commit message is passed through
 * stdin so it can never be parsed as a git option.
 */
function runGitWithInput(
  cwd: string,
  args: string[],
  input: string,
): Promise<GitResult> {
  return enqueue(() => executeGitWithInput(cwd, args, input));
}

/**
 * Runs a single git command that reads its input from stdin.
 */
function executeGitWithInput(
  cwd: string,
  args: string[],
  input: string,
): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_CONFIG_NOSYSTEM: '1',
        LC_ALL: 'C',
      },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
      }
    }, GIT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length <= MAX_OUTPUT_BYTES) {
        stdout += chunk;
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length + chunk.length <= MAX_OUTPUT_BYTES) {
        stderr += chunk;
      }
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: error.message,
        spawnFailed: true,
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, spawnFailed: false });
    });

    child.stdin.on('error', () => {
      // The process may exit before the message is written (e.g. an empty
      // message); the exit code carries the real failure.
    });
    child.stdin.end(input, 'utf8');
  });
}
