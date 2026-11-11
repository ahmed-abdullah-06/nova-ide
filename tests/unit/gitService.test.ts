/**
 * Git service tests (spec §16, §19).
 *
 * The real service runs real `git` commands against real repositories in
 * temporary directories, so the argument handling, the repository detection
 * and the path confinement are verified for real.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitService } from '../../apps/desktop/src/main/services/gitService';

const run = promisify(execFile);

let root = '';
let service: GitService | null = null;

/** Runs a git command in the given directory. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run('git', args, { cwd });
  return result.stdout;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-git-'));
  service = new GitService({ getRoot: () => root });
});

afterEach(async () => {
  service = null;
  await rm(root, { recursive: true, force: true });
});

/** Turns the directory into a repository with one commit. */
async function initRepository(): Promise<void> {
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'NOVA Test');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'readme.md'), '# hello\n', 'utf8');
  await git(root, 'add', 'readme.md');
  await git(root, 'commit', '-m', 'initial commit');
}

describe('git status', () => {
  it('reports that a plain folder is not a repository', async () => {
    const status = await service?.status();
    expect(status?.ok).toBe(true);
    if (status?.ok) {
      expect(status.value.isRepository).toBe(false);
      expect(status.value.branch).toBeNull();
    }
  });

  it('refuses to work without a workspace', async () => {
    const withoutWorkspace = new GitService({ getRoot: () => null });
    const status = await withoutWorkspace.status();
    expect(status?.ok).toBe(false);
    if (status && !status.ok) {
      expect(status.code).toBe('NO_WORKSPACE');
    }
  });

  it('reports a helpful error when git is not installed', async () => {
    // Git is looked up on the PATH; an empty PATH makes the spawn fail.
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const status = await service?.status();
      expect(status?.ok).toBe(false);
      if (status && !status.ok) {
        expect(status.code).toBe('UNKNOWN');
        expect(status.message).toMatch(/git/i);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('reports a clean repository', async () => {
    await initRepository();
    const status = await service?.status();
    expect(status?.ok).toBe(true);
    if (status?.ok) {
      expect(status.value.isRepository).toBe(true);
      expect(status.value.branch).toBe('main');
      expect(status.value.staged).toHaveLength(0);
      expect(status.value.unstaged).toHaveLength(0);
      expect(status.value.untracked).toHaveLength(0);
    }
  });

  it('reports modified, staged and untracked files', async () => {
    await initRepository();
    await writeFile(path.join(root, 'readme.md'), '# changed\n', 'utf8');
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    await git(root, 'add', 'new.txt');

    const status = await service?.status();
    expect(status?.ok).toBe(true);
    if (status?.ok) {
      const stagedNames = status.value.staged.map((c) => c.relativePath);
      const unstagedNames = status.value.unstaged.map((c) => c.relativePath);
      const untrackedNames = status.value.untracked.map((c) => c.relativePath);
      expect(stagedNames).toContain('new.txt');
      expect(unstagedNames).toContain('readme.md');
      expect(untrackedNames).toHaveLength(0);
    }
  });
});

describe('git actions', () => {
  it('stages a file', async () => {
    await initRepository();
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    const result = await service?.stage(path.join(root, 'new.txt'));
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.staged.map((c) => c.relativePath)).toContain('new.txt');
    }
  });

  it('unstages a file', async () => {
    await initRepository();
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    await git(root, 'add', 'new.txt');
    const result = await service?.unstage(path.join(root, 'new.txt'));
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.staged).toHaveLength(0);
    }
  });

  it('discards the changes of a file', async () => {
    await initRepository();
    await writeFile(path.join(root, 'readme.md'), '# changed\n', 'utf8');
    const result = await service?.discard(path.join(root, 'readme.md'));
    expect(result?.ok).toBe(true);
    const content = await readFile(path.join(root, 'readme.md'), 'utf8');
    expect(content).toContain('# hello');
  });

  it('creates a commit', async () => {
    await initRepository();
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    await git(root, 'add', 'new.txt');
    const result = await service?.commit('add new file');
    expect(result?.ok).toBe(true);
    const log = await git(root, 'log', '--oneline', '-1');
    expect(log).toContain('add new file');
  });

  it('refuses an empty commit message', async () => {
    await initRepository();
    const result = await service?.commit('   ');
    expect(result?.ok).toBe(false);
  });

  it('treats a commit message as data, not as options', async () => {
    await initRepository();
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    await git(root, 'add', 'new.txt');
    // A message that looks like a git option must not be interpreted.
    const result = await service?.commit('--amend --no-verify');
    expect(result?.ok).toBe(true);
    const log = await git(root, 'log', '--oneline', '-1');
    expect(log).toContain('--amend --no-verify');
  });

  it('returns the diff of a file', async () => {
    await initRepository();
    await writeFile(path.join(root, 'readme.md'), '# changed\n', 'utf8');
    const result = await service?.diff(path.join(root, 'readme.md'), false);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.diff).toContain('-# hello');
      expect(result.value.diff).toContain('+# changed');
    }
  });
});

describe('git branches', () => {
  it('lists the local branches and marks the current one', async () => {
    await initRepository();
    await git(root, 'branch', 'feature/search');
    const result = await service?.branches();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const names = result.value.map((branch) => branch.name);
      expect(names).toContain('main');
      expect(names).toContain('feature/search');
      const current = result.value.find((branch) => branch.current);
      expect(current?.name).toBe('main');
    }
  });

  it('returns an empty list when there is no repository', async () => {
    const result = await service?.branches();
    // A folder that is not a repository has no branches.
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('switches to another branch', async () => {
    await initRepository();
    await git(root, 'branch', 'feature/search');
    const result = await service?.switchBranch('feature/search');
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.branch).toBe('feature/search');
    }
    const branch = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
    expect(branch.trim()).toBe('feature/search');
  });

  it('keeps the current branch when it is selected again', async () => {
    await initRepository();
    const result = await service?.switchBranch('main');
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.value.branch).toBe('main');
    }
  });

  it('refuses a branch that does not exist', async () => {
    await initRepository();
    const result = await service?.switchBranch('does-not-exist');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('refuses a branch name that could be an option', async () => {
    await initRepository();
    const result = await service?.switchBranch('--upload-pack=evil');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('INVALID_PATH');
    }
  });

  it('refuses an empty branch name', async () => {
    await initRepository();
    const result = await service?.switchBranch('');
    expect(result?.ok).toBe(false);
  });
});

describe('git path confinement', () => {
  it('refuses a path outside the workspace', async () => {
    await initRepository();
    const outside = await mkdtemp(path.join(tmpdir(), 'nova-outside-'));
    try {
      const result = await service?.stage(path.join(outside, 'file.txt'));
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.code).toBe('OUTSIDE_WORKSPACE');
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a traversal attempt', async () => {
    await initRepository();
    const result = await service?.stage(path.join(root, '..', 'escape.txt'));
    expect(result?.ok).toBe(false);
  });

  it('refuses to stage the workspace root', async () => {
    await initRepository();
    const result = await service?.stage(root);
    expect(result?.ok).toBe(false);
  });

  it('does not let a file name be interpreted as an option', async () => {
    await initRepository();
    await mkdir(path.join(root, 'sub'), { recursive: true });
    // A file whose name starts with a dash must be staged as a path.
    await writeFile(path.join(root, 'sub', '--upload-pack=evil'), 'x\n', 'utf8');
    const result = await service?.stage(
      path.join(root, 'sub', '--upload-pack=evil'),
    );
    expect(result?.ok).toBe(true);
    const staged = await git(root, 'diff', '--cached', '--name-only');
    expect(staged).toContain('--upload-pack=evil');
  });
});
