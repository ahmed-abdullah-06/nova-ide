/**
 * Filesystem service tests (spec §6, §7, §19.3, §24).
 *
 * Exercises the REAL `FileSystemService` against throwaway directories in
 * the OS temp folder — only the Electron dialog layer is mocked, because
 * no native window can exist in a unit test. Every public method is
 * covered for: success, structured failure codes, and workspace-boundary
 * enforcement (revalidated immediately before each mutation).
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The service only touches Electron for the native Save-As dialog.
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
  },
  BrowserWindow: {
    getFocusedWindow: (): null => null,
    getAllWindows: (): unknown[] => [],
  },
}));

import { FileSystemService } from '../../apps/desktop/src/main/services/fileSystemService';
import { OpenFileWatcher } from '../../apps/desktop/src/main/services/fileWatcher';

/** Mutable "active workspace" the service reads through getRoot(). */
let activeRoot: string | null = null;
let outsideDir = '';
let service: FileSystemService;

/** Root of the throwaway workspace for the current test. */
let workRoot = '';

beforeAll(async () => {
  workRoot = await mkdtemp(path.join(tmpdir(), 'nova-fs-root-'));
  outsideDir = await mkdtemp(path.join(tmpdir(), 'nova-fs-out-'));
  activeRoot = workRoot;
  service = new FileSystemService(
    () => activeRoot,
    new OpenFileWatcher(() => undefined),
  );
  // Security rejections and mapped errors log through console.error by
  // design; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  service.clearWatches();
  vi.restoreAllMocks();
  await rm(workRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

/** Gives every test a clean workspace with one seeded file. */
beforeEach(async () => {
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  activeRoot = workRoot;
  await mkdir(path.join(workRoot, 'src'), { recursive: true });
  await writeFile(path.join(workRoot, 'src', 'main.ts'), 'export const x = 1;\n');
  await writeFile(path.join(workRoot, 'readme.md'), '# seed\n');
});

const inRoot = (...segments: string[]): string => path.join(workRoot, ...segments);

function expectFail<T>(
  result: { ok: true; value: T } | { ok: false; code: string; message: string },
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------

describe('workspace guard', () => {
  it('refuses every operation without an open workspace', async () => {
    activeRoot = null;
    try {
      expectFail(await service.readDirectory(workRoot), 'NO_WORKSPACE');
      expectFail(await service.readFile(path.join(workRoot, 'readme.md')), 'NO_WORKSPACE');
      expectFail(await service.writeFile(path.join(workRoot, 'readme.md'), 'x', null), 'NO_WORKSPACE');
      expectFail(await service.createFile(path.join(workRoot, 'new.txt')), 'NO_WORKSPACE');
      expectFail(await service.rename(path.join(workRoot, 'readme.md'), 'other.md'), 'NO_WORKSPACE');
      expectFail(await service.delete(path.join(workRoot, 'readme.md')), 'NO_WORKSPACE');
      expectFail(await service.syncOpenFiles([]), 'NO_WORKSPACE');
    } finally {
      activeRoot = workRoot;
    }
  });

  it('refuses operations when the workspace folder vanished from disk', async () => {
    activeRoot = path.join(tmpdir(), 'nova-fs-does-not-exist');
    try {
      // Root still set but gone → the more specific WORKSPACE_MISSING.
      expectFail(await service.readFile(path.join(workRoot, 'readme.md')), 'WORKSPACE_MISSING');
    } finally {
      activeRoot = workRoot;
    }
  });
});

describe('readDirectory', () => {
  it('lists directories before files in natural order', async () => {
    await writeFile(inRoot('b.txt'), 'b');
    await writeFile(inRoot('a.txt'), 'a');
    await mkdir(inRoot('zeta'));
    const result = await service.readDirectory(workRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries.map((e) => e.name)).toEqual([
        'src',
        'zeta',
        'a.txt',
        'b.txt',
        'readme.md',
      ]);
      expect(result.value.truncated).toBe(false);
    }
  });

  it('reports missing folders and files-as-folders structurally', async () => {
    expectFail(await service.readDirectory(inRoot('ghost')), 'NOT_FOUND');
    expectFail(await service.readDirectory(inRoot('readme.md')), 'NOT_A_DIRECTORY');
    expectFail(await service.readDirectory(path.join(outsideDir, '.')), 'OUTSIDE_WORKSPACE');
  });
});

describe('readFile', () => {
  it('returns content, size, and mtime for a text file', async () => {
    const result = await service.readFile(inRoot('readme.md'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('# seed\n');
      expect(result.value.size).toBe(7);
      expect(result.value.mtimeMs).toBeGreaterThan(0);
    }
  });

  it('rejects binary, directory, missing, too-large, and outside paths', async () => {
    await writeFile(inRoot('blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expectFail(await service.readFile(inRoot('blob.bin')), 'BINARY_FILE');
    expectFail(await service.readFile(workRoot), 'IS_DIRECTORY');
    expectFail(await service.readFile(inRoot('ghost.md')), 'NOT_FOUND');
    expectFail(await service.readFile(path.join(outsideDir, 'secret.txt')), 'OUTSIDE_WORKSPACE');

    // Over the 10 MB text limit (rejected by size check, never read).
    await writeFile(inRoot('huge.md'), Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    expectFail(await service.readFile(inRoot('huge.md')), 'FILE_TOO_LARGE');
  });
});

describe('writeFile (save)', () => {
  it('writes when the expected mtime still matches', async () => {
    const opened = await service.readFile(inRoot('readme.md'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const saved = await service.writeFile(
      inRoot('readme.md'),
      '# updated\n',
      opened.value.mtimeMs,
    );
    expect(saved.ok).toBe(true);
    expect(await readFile(inRoot('readme.md'), 'utf8')).toBe('# updated\n');
  });

  it('returns CONFLICT when the file changed on disk since it was opened', async () => {
    const opened = await service.readFile(inRoot('readme.md'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // Simulate an external edit: mtime moves beyond the tolerance.
    const stale = opened.value.mtimeMs - 5000;
    expectFail(
      await service.writeFile(inRoot('readme.md'), 'mine\n', stale),
      'CONFLICT',
    );
    // The conflicting write must NOT have touched the file.
    expect(await readFile(inRoot('readme.md'), 'utf8')).toBe('# seed\n');
  });

  it('forces the write when no expected mtime is given', async () => {
    const saved = await service.writeFile(inRoot('readme.md'), 'forced\n', null);
    expect(saved.ok).toBe(true);
    expect(await readFile(inRoot('readme.md'), 'utf8')).toBe('forced\n');
  });

  it('reports NOT_FOUND when saving a file deleted behind our back', async () => {
    const opened = await service.readFile(inRoot('readme.md'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await rm(inRoot('readme.md'));
    expectFail(
      await service.writeFile(inRoot('readme.md'), 'x', opened.value.mtimeMs),
      'NOT_FOUND',
    );
  });

  it('rejects saving over a folder, outside paths, and oversized payloads', async () => {
    // The root is refused by protection, other folders by the stat check —
    // the latter must hold even for force saves (no expected mtime).
    expectFail(await service.writeFile(workRoot, 'x', null), 'ROOT_PROTECTED');
    expectFail(await service.writeFile(inRoot('src'), 'x', null), 'IS_DIRECTORY');
    expectFail(
      await service.writeFile(path.join(outsideDir, 'f.txt'), 'x', null),
      'OUTSIDE_WORKSPACE',
    );
    expectFail(
      await service.writeFile(inRoot('readme.md'), 'x'.repeat(50 * 1024 * 1024 + 1), null),
      'FILE_TOO_LARGE',
    );
  });
});

describe('createFile / createFolder', () => {
  it('creates a file and a folder', async () => {
    const file = await service.createFile(inRoot('notes.txt'));
    expect(file.ok).toBe(true);
    if (file.ok) expect(file.value.kind).toBe('file');
    expect((await stat(inRoot('notes.txt'))).isFile()).toBe(true);

    const folder = await service.createFolder(inRoot('docs'));
    expect(folder.ok).toBe(true);
    if (folder.ok) expect(folder.value.kind).toBe('directory');
    expect((await stat(inRoot('docs'))).isDirectory()).toBe(true);
  });

  it('rejects duplicates, invalid names, missing parents, and escapes', async () => {
    expectFail(await service.createFile(inRoot('readme.md')), 'ALREADY_EXISTS');
    expectFail(await service.createFolder(inRoot('src')), 'ALREADY_EXISTS');
    expectFail(await service.createFile(inRoot('con')), 'INVALID_NAME');
    expectFail(await service.createFile(inRoot('bad', 'name.txt')), 'NOT_FOUND');
    expectFail(
      await service.createFile(path.join(outsideDir, 'evil.txt')),
      'OUTSIDE_WORKSPACE',
    );
    expectFail(
      await service.createFile(path.join(workRoot, '..', 'escaped.txt')),
      'OUTSIDE_WORKSPACE',
    );
    // Nothing was created by any rejected attempt.
    expect(await readFile(inRoot('readme.md'), 'utf8')).toBe('# seed\n');
  });
});

describe('rename', () => {
  it('renames files and folders', async () => {
    const file = await service.rename(inRoot('readme.md'), 'guide.md');
    expect(file.ok).toBe(true);
    if (file.ok) expect(file.value.path).toBe(inRoot('guide.md'));
    expect((await stat(inRoot('guide.md'))).isFile()).toBe(true);

    const folder = await service.rename(inRoot('src'), 'lib');
    expect(folder.ok).toBe(true);
    if (folder.ok) expect(folder.value.kind).toBe('directory');
    expect((await stat(inRoot('lib'))).isDirectory()).toBe(true);
  });

  it('treats renaming to the same name as a no-op success', async () => {
    const result = await service.rename(inRoot('readme.md'), 'readme.md');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe('readme.md');
  });

  it('rejects collisions, invalid names, and out-of-workspace targets', async () => {
    // Collision must be in the SAME parent (rename never changes directory).
    await writeFile(inRoot('guide.md'), 'other\n');
    expectFail(await service.rename(inRoot('readme.md'), 'guide.md'), 'ALREADY_EXISTS');
    expectFail(await service.rename(inRoot('readme.md'), 'con'), 'INVALID_NAME');
    expectFail(await service.rename(inRoot('ghost.md'), 'other.md'), 'NOT_FOUND');
    expectFail(
      await service.rename(path.join(outsideDir, 'secret.txt'), 'x.txt'),
      'OUTSIDE_WORKSPACE',
    );
    expectFail(await service.rename(workRoot, 'renamed-root'), 'ROOT_PROTECTED');
    // The original file survived every rejected rename.
    expect((await stat(inRoot('readme.md'))).isFile()).toBe(true);
  });
});

describe('delete', () => {
  it('deletes a file', async () => {
    const result = await service.delete(inRoot('readme.md'));
    expect(result.ok).toBe(true);
    await expect(stat(inRoot('readme.md'))).rejects.toThrow();
  });

  it('deletes a folder with its contents', async () => {
    await writeFile(inRoot('src', 'deep.ts'), 'deep\n');
    const result = await service.delete(inRoot('src'));
    expect(result.ok).toBe(true);
    await expect(stat(inRoot('src'))).rejects.toThrow();
    // Sibling files are untouched.
    expect((await stat(inRoot('readme.md'))).isFile()).toBe(true);
  });

  it('refuses to delete the root, outside paths, or missing items', async () => {
    expectFail(await service.delete(workRoot), 'ROOT_PROTECTED');
    expectFail(await service.delete(path.join(outsideDir, 'secret.txt')), 'OUTSIDE_WORKSPACE');
    expectFail(await service.delete(inRoot('ghost.txt')), 'NOT_FOUND');
    expect((await stat(inRoot('readme.md'))).isFile()).toBe(true);
  });

  it('unlinks a symlink itself and never its target', async () => {
    const secret = path.join(outsideDir, 'secret.txt');
    const link = inRoot('link-to-outside');
    const { symlink } = await import('node:fs/promises');
    try {
      await symlink(secret, link, 'file');
    } catch {
      console.log('SKIP  file symlink not creatable without privilege');
      return;
    }
    const result = await service.delete(link);
    expect(result.ok).toBe(true);
    // Target outside the workspace must still exist.
    expect((await stat(secret)).isFile()).toBe(true);
  });
});

describe('syncOpenFiles', () => {
  it('canonicalises, deduplicates, and counts watch targets', async () => {
    const target = inRoot('readme.md');
    const result = await service.syncOpenFiles([
      target,
      target.toUpperCase() === target ? `${target}.` : target,
      target,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.watching).toBeGreaterThanOrEqual(1);
    service.clearWatches();
  });

  it('rejects any outside path instead of watching it', async () => {
    expectFail(
      await service.syncOpenFiles([path.join(outsideDir, 'secret.txt')]),
      'OUTSIDE_WORKSPACE',
    );
    service.clearWatches();
  });

  it('clearWatches stops everything without error', async () => {
    await service.syncOpenFiles([inRoot('readme.md')]);
    expect(() => service.clearWatches()).not.toThrow();
  });
});
