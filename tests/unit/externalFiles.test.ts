/**
 * Native Open File + external grant tests (A6).
 *
 * Uses the real filesystem service against throwaway directories; only the
 * Electron dialog is mocked. The tests prove that outside files are only
 * reachable through an opaque grant, that the grant targets one canonical
 * path, and that workspace containment is unchanged.
 */
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: (): null => null,
    getAllWindows: (): unknown[] => [],
  },
}));

import { dialog } from 'electron';
import { ExternalFileGrants } from '../../apps/desktop/src/main/services/externalFileGrants';
import { ExternalFileService } from '../../apps/desktop/src/main/services/externalFileService';
import { FileSystemService } from '../../apps/desktop/src/main/services/fileSystemService';
import { OpenFileWatcher } from '../../apps/desktop/src/main/services/fileWatcher';
import type { OpenFileSelection } from '../../apps/desktop/src/shared/ipc-types';

let workRoot = '';
let outsideDir = '';
let activeRoot: string | null = null;
let files: FileSystemService;
let external: ExternalFileService;

const inRoot = (...segments: string[]): string => path.join(workRoot, ...segments);
const outside = (...segments: string[]): string => path.join(outsideDir, ...segments);

beforeAll(async () => {
  workRoot = await mkdtemp(path.join(tmpdir(), 'nova-open-root-'));
  outsideDir = await mkdtemp(path.join(tmpdir(), 'nova-open-out-'));
  files = new FileSystemService(
    () => activeRoot,
    new OpenFileWatcher(() => undefined),
  );
  external = new ExternalFileService(files, () => activeRoot);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  files.clearWatches();
  vi.restoreAllMocks();
  await rm(workRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(workRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(inRoot('readme.md'), '# workspace\n');
  await writeFile(outside('secret.txt'), 'outside content\n');
  activeRoot = workRoot;
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: true,
    filePaths: [],
  });
});

async function pick(filePath: string): Promise<OpenFileSelection> {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: [filePath],
  });
  const result = await external.open();
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  expect(result.value).not.toBeNull();
  return result.value as OpenFileSelection;
}

describe('native Open File dialog', () => {
  it('returns null when the user cancels, and asks for no renderer path', async () => {
    const result = await external.open();
    expect(result).toEqual({ ok: true, value: null });
    expect(dialog.showOpenDialog).toHaveBeenCalled();
    const options = vi.mocked(dialog.showOpenDialog).mock.calls.at(-1)?.at(-1);
    expect(options).toMatchObject({ properties: ['openFile'] });
  });

  it('classifies a workspace file without issuing a grant', async () => {
    const selection = await pick(inRoot('readme.md'));
    expect(selection.origin).toBe('workspace');
    expect(selection.name).toBe('readme.md');
    expect(selection.grantId).toBeUndefined();
    expect(selection.path).toBe(inRoot('readme.md'));
  });

  it('classifies an outside file as external with an opaque grant', async () => {
    const selection = await pick(outside('secret.txt'));
    expect(selection.origin).toBe('external');
    expect(selection.path).toBe(outside('secret.txt'));
    expect(selection.name).toBe('secret.txt');
    expect(selection.grantId).toBeTruthy();
    // The grant is an id, not a path the renderer could rewrite.
    expect(selection.grantId).not.toContain('\\');
    expect(selection.grantId).not.toContain('/');
  });

  it('treats every file as external when no workspace is open', async () => {
    activeRoot = null;
    const selection = await pick(inRoot('readme.md'));
    expect(selection.origin).toBe('external');
    expect(selection.grantId).toBeTruthy();
  });

  it('canonicalises a symlink inside the workspace before classifying it', async () => {
    const target = outside('secret.txt');
    const link = inRoot('link.txt');
    try {
      await symlink(target, link, 'file');
    } catch {
      console.log('SKIP  file symlink not creatable without privilege');
      return;
    }
    const selection = await pick(link);
    expect(selection.origin).toBe('external');
    expect(selection.path).toBe(target);
  });
});

describe('grant-scoped read and write', () => {
  it('reads and saves only the granted canonical file', async () => {
    const selection = await pick(outside('secret.txt'));
    const grantId = selection.grantId as string;

    const read = await external.read(grantId);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.content).toBe('outside content\n');
      expect(read.value.path).toBe(outside('secret.txt'));
    }

    const saved = await external.write(grantId, 'new content\n', read.ok ? read.value.mtimeMs : null);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.path).toBe(outside('secret.txt'));
    }
    expect(await readFile(outside('secret.txt'), 'utf8')).toBe('new content\n');
  });

  it('enforces the same mtime conflict check as workspace saves', async () => {
    const selection = await pick(outside('secret.txt'));
    const grantId = selection.grantId as string;
    const stale = await external.write(grantId, 'forced\n', 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe('CONFLICT');
    }
    expect(await readFile(outside('secret.txt'), 'utf8')).toBe('outside content\n');
  });

  it('refuses forged, empty and path-shaped grant ids', async () => {
    for (const id of ['', 'forged-id', outside('secret.txt'), inRoot('readme.md')]) {
      expect((await external.read(id)).ok).toBe(false);
      expect((await external.write(id, 'bad\n', null)).ok).toBe(false);
    }
  });

  it('refuses a grant whose path changed identity on disk', async () => {
    const original = outside('secret.txt');
    const moved = outside('moved.txt');
    const selection = await pick(original);
    const grantId = selection.grantId as string;
    await rename(original, moved);
    try {
      await symlink(moved, original, 'file');
    } catch {
      console.log('SKIP  file symlink not creatable without privilege');
      return;
    }
    expect((await external.read(grantId)).ok).toBe(false);
    // The symlink target itself was never granted.
    expect((await external.read('forged-id')).ok).toBe(false);
  });

  it('reports a missing granted file instead of recreating it silently', async () => {
    const selection = await pick(outside('secret.txt'));
    const grantId = selection.grantId as string;
    await rm(outside('secret.txt'));
    const result = await external.read(grantId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});

describe('ExternalFileGrants', () => {
  it('reuses a grant per canonical path and forgets everything on clear', async () => {
    const grants = new ExternalFileGrants();
    const filePath = outside('secret.txt');
    const id = grants.issue(filePath);
    expect(grants.issue(filePath)).toBe(id);
    expect(grants.size).toBe(1);
    expect((await grants.resolve(id)).ok).toBe(true);
    grants.clear();
    expect(grants.size).toBe(0);
    expect((await grants.resolve(id)).ok).toBe(false);
  });
});
