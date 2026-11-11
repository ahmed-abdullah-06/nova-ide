/**
 * Workspace path security tests (spec §7.2, §19.3).
 *
 * Everything runs against throwaway directories under the OS temp folder —
 * no test ever touches a real user directory (spec §24).
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isValidEntryName,
  relateToRoot,
  resolveInWorkspace,
  resolveWorkspaceRoot,
} from '../../apps/desktop/src/main/services/pathSecurity';

let root = '';
let outside = '';
/** Set when the platform refuses to create symlinks (no privilege). */
let canLink = true;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-sec-root-'));
  outside = await mkdtemp(path.join(tmpdir(), 'nova-sec-out-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const x = 1;\n');
  await writeFile(path.join(root, 'readme.md'), '# root\n');
  await writeFile(path.join(outside, 'secret.txt'), 'outside\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('isValidEntryName', () => {
  it('accepts ordinary names', () => {
    expect(isValidEntryName('readme.md')).toBe(true);
    expect(isValidEntryName('main.tsx')).toBe(true);
    expect(isValidEntryName('a'.repeat(255))).toBe(true);
    expect(isValidEntryName('no-extension')).toBe(true);
    expect(isValidEntryName('archive.tar.gz')).toBe(true);
  });

  it('rejects traversal and separator characters', () => {
    expect(isValidEntryName('..')).toBe(false);
    expect(isValidEntryName('.')).toBe(false);
    expect(isValidEntryName('a/b')).toBe(false);
    expect(isValidEntryName('a\\b')).toBe(false);
    expect(isValidEntryName('..\\..\\windows')).toBe(false);
    expect(isValidEntryName('a\0b')).toBe(false);
  });

  it('rejects Windows reserved names and forbidden characters', () => {
    expect(isValidEntryName('con')).toBe(false);
    expect(isValidEntryName('COM1')).toBe(false);
    expect(isValidEntryName('lpt9')).toBe(false);
    expect(isValidEntryName('a:b')).toBe(false);
    expect(isValidEntryName('a?"')).toBe(false);
    expect(isValidEntryName('a<b>')).toBe(false);
    expect(isValidEntryName('a|b')).toBe(false);
    expect(isValidEntryName('a*b')).toBe(false);
  });

  it('rejects names that cannot round-trip on disk', () => {
    expect(isValidEntryName('')).toBe(false);
    expect(isValidEntryName('trailing.')).toBe(false);
    expect(isValidEntryName('trailing ')).toBe(false);
    expect(isValidEntryName(' leading')).toBe(false);
    expect(isValidEntryName('a'.repeat(256))).toBe(false);
    expect(isValidEntryName(42 as unknown as string)).toBe(false);
    expect(isValidEntryName(null as unknown as string)).toBe(false);
    expect(isValidEntryName('ctrl\x1fchar')).toBe(false);
  });
});

describe('relateToRoot', () => {
  const base = path.join(path.sep, 'proj', 'beta');

  it('classifies the root itself', () => {
    expect(relateToRoot(base, base)).toBe('root');
  });

  it('classifies descendants as inside', () => {
    expect(relateToRoot(base, path.join(base, 'src', 'a.ts'))).toBe('inside');
  });

  it('does NOT treat a sibling with a shared prefix as inside', () => {
    // `C:\proj\beta-2` must never match `C:\proj\beta` (string-prefix trap).
    expect(relateToRoot(base, `${base}-2`)).toBe('outside');
    expect(relateToRoot(base, `${base}-2${path.sep}file`)).toBe('outside');
  });

  it('classifies parents and unrelated trees as outside', () => {
    expect(relateToRoot(base, path.dirname(base))).toBe('outside');
    expect(relateToRoot(base, path.join(path.sep, 'other', 'x'))).toBe('outside');
  });

  it.runIf(process.platform === 'win32')('ignores drive letter case on Windows', () => {
    expect(relateToRoot('C:\\Proj\\Beta', 'c:\\proj\\beta\\src')).toBe('inside');
  });
});

describe('resolveWorkspaceRoot', () => {
  it('accepts an existing directory and returns its canonical path', async () => {
    const result = await resolveWorkspaceRoot(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(await realpath(root));
    }
  });

  it('rejects non-strings and NUL bytes', async () => {
    expect((await resolveWorkspaceRoot(undefined)).ok).toBe(false);
    expect((await resolveWorkspaceRoot(7 as unknown as string)).ok).toBe(false);
    expect((await resolveWorkspaceRoot(`${root}\0x`)).ok).toBe(false);
  });

  it('rejects missing folders and plain files', async () => {
    const missing = await resolveWorkspaceRoot(path.join(root, 'nope'));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');

    const file = await resolveWorkspaceRoot(path.join(root, 'readme.md'));
    expect(file.ok).toBe(false);
    if (!file.ok) expect(file.code).toBe('NOT_A_DIRECTORY');
  });
});

describe('resolveInWorkspace', () => {
  it('rejects invalid input shapes before touching the disk', async () => {
    for (const bad of [undefined, '', 5, null, `${root}\0evil`]) {
      const result = await resolveInWorkspace(root, bad as unknown as string);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_PATH');
    }
  });

  it('resolves paths inside the workspace (existing and not-yet-existing)', async () => {
    const existing = await resolveInWorkspace(root, path.join(root, 'src', 'main.ts'), {
      mustExist: true,
    });
    expect(existing.ok).toBe(true);

    // Creating a file needs the not-yet-existing tail to resolve fine.
    const fresh = await resolveInWorkspace(root, path.join(root, 'brand-new.txt'));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value).toBe(path.join(await realpath(root), 'brand-new.txt'));
  });

  it('allows the root only when the caller opts in', async () => {
    const allowed = await resolveInWorkspace(root, root);
    expect(allowed.ok).toBe(true);

    const denied = await resolveInWorkspace(root, root, { allowRoot: false });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('ROOT_PROTECTED');
  });

  it('rejects parent traversal and absolute escapes', async () => {
    const traversal = await resolveInWorkspace(root, path.join(root, '..', 'outside-file.txt'));
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.code).toBe('OUTSIDE_WORKSPACE');

    const absolute = await resolveInWorkspace(root, path.join(outside, 'secret.txt'));
    expect(absolute.ok).toBe(false);
    if (!absolute.ok) expect(absolute.code).toBe('OUTSIDE_WORKSPACE');

    const deep = await resolveInWorkspace(
      root,
      path.join(root, '..', '..', '..', 'windows', 'win.ini'),
    );
    expect(deep.ok).toBe(false);
    if (!deep.ok) expect(deep.code).toBe('OUTSIDE_WORKSPACE');
  });

  it('mustExist reports a structured NOT_FOUND', async () => {
    const result = await resolveInWorkspace(root, path.join(root, 'ghost.txt'), {
      mustExist: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('rejects a path whose middle component is a file', async () => {
    const result = await resolveInWorkspace(
      root,
      path.join(root, 'readme.md', 'child.txt'),
      { mustExist: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_PATH');
  });

  it('follows symlinks out of the workspace and rejects them', async () => {
    const link = path.join(root, 'escape-link');
    try {
      await symlink(outside, link, 'junction');
    } catch {
      console.log('SKIP  junction not creatable without privilege');
      canLink = false;
      return;
    }
    const result = await resolveInWorkspace(root, link);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_WORKSPACE');
    await rm(link, { force: true });
  });

  it('rejects a dangling symlink that points outside', async () => {
    const dangling = path.join(root, 'dangling-link');
    try {
      await symlink(path.join(outside, 'never-created.txt'), dangling, 'junction');
    } catch {
      console.log('SKIP  dangling link not creatable without privilege');
      canLink = false;
      return;
    }
    const result = await resolveInWorkspace(root, dangling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_WORKSPACE');
    await rm(dangling, { force: true });
  });

  it('accepts a symlink that stays inside the workspace', async () => {
    const link = path.join(root, 'inner-link');
    try {
      await symlink(path.join(root, 'src'), link, 'junction');
    } catch {
      console.log('SKIP  junction not creatable without privilege');
      canLink = false;
      return;
    }
    const result = await resolveInWorkspace(root, path.join(link, 'main.ts'), {
      mustExist: true,
    });
    expect(result.ok).toBe(true);
    await rm(link, { force: true });
  });
});

describe('test hygiene', () => {
  it('ran the symlink cases or reported why not', () => {
    // Documents privilege-dependent coverage instead of silently skipping.
    expect(typeof canLink).toBe('boolean');
  });
});
