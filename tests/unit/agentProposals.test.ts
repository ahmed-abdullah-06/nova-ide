/**
 * Tests for the change proposals of the agent (spec §12.1, §13).
 *
 * A proposal is never written to the disk before the user accepts it,
 * and the write refuses to overwrite a file that changed in the
 * meantime.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diffLines, unifiedDiff } from '../../apps/desktop/src/main/agent/diff';
import { ProposalStore } from '../../apps/desktop/src/main/agent/proposalStore';
import {
  applyRevert,
  previewRevert,
} from '../../apps/desktop/src/main/agent/revertPlan';

/** The directory the store writes its checkpoints into. */
let userData = '';

/** The mocked Electron module. */
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const { writeProposal } = await import(
  '../../apps/desktop/src/main/agent/writeProposal'
);

let root = '';

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-checkpoint-'));
  root = await mkdtemp(path.join(tmpdir(), 'nova-proposal-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.ts'), 'const a = 1;\n', 'utf8');
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe('the diff of a proposal', () => {
  it('marks the changed lines', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('marks every line of a new file', () => {
    const lines = diffLines('', 'a\nb\n');
    expect(lines.filter((line) => line.kind === 'added')).toHaveLength(2);
  });

  it('creates a unified diff', () => {
    const diff = unifiedDiff('a\n', 'b\n', 'src/app.ts', 'src/app.ts');
    expect(diff).toContain('--- a/src/app.ts');
    expect(diff).toContain('+++ b/src/app.ts');
    expect(diff).toContain('-a');
    expect(diff).toContain('+b');
  });

  it('creates no diff for an unchanged file', () => {
    expect(unifiedDiff('a\n', 'a\n', 'x.ts', 'x.ts')).toBe('');
  });
});

describe('the proposals of a run', () => {
  it('creates a proposal with a diff', () => {
    const store = new ProposalStore();
    const proposal = store.create('run-1', {
      path: path.join(root, 'src', 'app.ts'),
      relativePath: 'src/app.ts',
      before: 'const a = 1;\n',
      after: 'const a = 2;\n',
      expectedMtimeMs: 1,
      created: false,
    });
    expect(proposal.runId).toBe('run-1');
    expect(proposal.diff).toContain('-const a = 1;');
    expect(store.list('run-1')).toHaveLength(1);
    expect(store.get('run-1', proposal.id)?.id).toBe(proposal.id);
  });

  it('removes a proposal', () => {
    const store = new ProposalStore();
    const proposal = store.create('run-1', {
      path: path.join(root, 'src', 'app.ts'),
      relativePath: 'src/app.ts',
      before: '',
      after: 'x\n',
      expectedMtimeMs: null,
      created: true,
    });
    store.remove('run-1', proposal.id);
    expect(store.list('run-1')).toHaveLength(0);
  });

  it('keeps the proposals of the runs apart', () => {
    const store = new ProposalStore();
    store.create('run-1', {
      path: path.join(root, 'a.ts'),
      relativePath: 'a.ts',
      before: '',
      after: 'x',
      expectedMtimeMs: null,
      created: true,
    });
    store.create('run-2', {
      path: path.join(root, 'b.ts'),
      relativePath: 'b.ts',
      before: '',
      after: 'y',
      expectedMtimeMs: null,
      created: true,
    });
    expect(store.list('run-1')).toHaveLength(1);
    expect(store.list('run-2')).toHaveLength(1);
  });
});

describe('the checkpoint of a run', () => {
  /** A file service over the real temporary directory. */
  function checkpointFiles() {
    return {
      readFile: async (file: string) => {
        try {
          const content = await readFile(file, 'utf8');
          const { stat } = await import('node:fs/promises');
          const info = await stat(file);
          return {
            ok: true as const,
            value: {
              path: file,
              content,
              mtimeMs: info.mtimeMs,
              size: content.length,
            },
          };
        } catch {
          return {
            ok: false as const,
            code: 'NOT_FOUND' as const,
            message: 'missing',
          };
        }
      },
      writeFile: async (
        file: string,
        content: string,
        expectedMtimeMs: number | null,
      ) => {
        if (expectedMtimeMs !== null) {
          const current = await checkpointFiles().readFile(file);
          if (
            current.ok &&
            Math.abs(current.value.mtimeMs - expectedMtimeMs) > 1
          ) {
            return {
              ok: false as const,
              code: 'CONFLICT' as const,
              message: 'the file changed',
            };
          }
        }
        await writeFile(file, content, 'utf8');
        return {
          ok: true as const,
          value: { path: file, mtimeMs: Date.now(), size: content.length },
        };
      },
      delete: async (file: string) => {
        await rm(file, { force: true });
        return { ok: true as const, value: { path: file } };
      },
    };
  }

  it('restores a file that was not changed after the run', async () => {
    const store = new ProposalStore();
    const file = path.join(root, 'src', 'app.ts');
    await writeFile(file, 'written by the run\n', 'utf8');
    await store.checkpoint('run-1', [
      {
        path: file,
        content: 'const a = 1;\n',
        after: 'written by the run\n',
      },
    ]);
    const checkpoint = store.checkpointOf('run-1');
    expect(checkpoint).toBeDefined();
    if (checkpoint === undefined) {
      return;
    }

    const preview = await previewRevert(
      checkpoint,
      root,
      [],
      checkpointFiles() as never,
    );
    expect(preview.files[0]?.conflict).toBeNull();
    const result = await applyRevert(
      checkpoint,
      preview,
      [],
      checkpointFiles() as never,
    );
    expect(result.restored).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\n');
  });

  it('refuses a newer edit on the disk without a confirmation', async () => {
    const store = new ProposalStore();
    const file = path.join(root, 'src', 'app.ts');
    await writeFile(file, 'written by the run\n', 'utf8');
    await store.checkpoint('run-1', [
      {
        path: file,
        content: 'const a = 1;\n',
        after: 'written by the run\n',
      },
    ]);
    const checkpoint = store.checkpointOf('run-1');
    if (checkpoint === undefined) {
      throw new Error('the checkpoint was not created');
    }
    // The user edits the file after the run finished.
    await writeFile(file, 'my newer edit\n', 'utf8');

    const preview = await previewRevert(
      checkpoint,
      root,
      [],
      checkpointFiles() as never,
    );
    expect(preview.files[0]?.conflict).toBe('changed-on-disk');
    const withoutConfirmation = await applyRevert(
      checkpoint,
      preview,
      [],
      checkpointFiles() as never,
    );
    expect(withoutConfirmation.restored).toBe(0);
    expect(withoutConfirmation.skipped).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toBe('my newer edit\n');

    // Only an explicit confirmation of THAT file overwrites it.
    const confirmed = await applyRevert(
      checkpoint,
      preview,
      [file],
      checkpointFiles() as never,
    );
    expect(confirmed.restored).toBe(1);
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\n');
  });

  it('treats an unsaved editor buffer as a conflict', async () => {
    const store = new ProposalStore();
    const file = path.join(root, 'src', 'app.ts');
    // The disk still holds the content of the run.
    await writeFile(file, 'written by the run\n', 'utf8');
    await store.checkpoint('run-1', [
      {
        path: file,
        content: 'const a = 1;\n',
        after: 'written by the run\n',
      },
    ]);
    const checkpoint = store.checkpointOf('run-1');
    if (checkpoint === undefined) {
      throw new Error('the checkpoint was not created');
    }

    const preview = await previewRevert(
      checkpoint,
      root,
      [file],
      checkpointFiles() as never,
    );
    expect(preview.files[0]?.conflict).toBe('dirty-buffer');
    const result = await applyRevert(
      checkpoint,
      preview,
      [],
      checkpointFiles() as never,
    );
    expect(result.restored).toBe(0);
    expect(await readFile(file, 'utf8')).toBe('written by the run\n');
  });

  it('removes a file that the run created', async () => {
    const store = new ProposalStore();
    const file = path.join(root, 'created.ts');
    await writeFile(file, 'new\n', 'utf8');
    await store.checkpoint('run-1', [
      { path: file, content: null, after: 'new\n' },
    ]);
    const checkpoint = store.checkpointOf('run-1');
    if (checkpoint === undefined) {
      throw new Error('the checkpoint was not created');
    }
    const preview = await previewRevert(
      checkpoint,
      root,
      [],
      checkpointFiles() as never,
    );
    expect(preview.files[0]?.action).toBe('delete');
    const result = await applyRevert(
      checkpoint,
      preview,
      [],
      checkpointFiles() as never,
    );
    expect(result.restored).toBe(1);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('collects the files of a run in the checkpoint', async () => {
    const store = new ProposalStore();
    await store.addToCheckpoint('run-1', {
      path: path.join(root, 'a.ts'),
      content: 'first\n',
    });
    await store.addToCheckpoint('run-1', {
      path: path.join(root, 'b.ts'),
      content: 'second\n',
    });
    const checkpoint = store.checkpointOf('run-1');
    expect(checkpoint?.files).toHaveLength(2);
  });

  it('keeps the first state of a file that the run changed twice', async () => {
    const store = new ProposalStore();
    const file = path.join(root, 'a.ts');
    await store.addToCheckpoint('run-1', { path: file, content: 'original\n' });
    await store.addToCheckpoint('run-1', { path: file, content: 'changed\n' });
    const checkpoint = store.checkpointOf('run-1');
    expect(checkpoint?.files).toHaveLength(1);
    expect(checkpoint?.files[0]?.content).toBe('original\n');
  });

  it('forgets the checkpoint of a run', async () => {
    const store = new ProposalStore();
    await store.addToCheckpoint('run-1', {
      path: path.join(root, 'a.ts'),
      content: 'x\n',
    });
    await store.forget('run-1');
    expect(store.checkpointOf('run-1')).toBeUndefined();
  });
});

describe('writing an accepted proposal', () => {
  /** A file service that only knows the workspace. */
  function fakeFiles() {
    return {
      readFile: async (file: string) => {
        try {
          const content = await readFile(file, 'utf8');
          const { stat } = await import('node:fs/promises');
          const info = await stat(file);
          return {
            ok: true as const,
            value: {
              path: file,
              content,
              mtimeMs: info.mtimeMs,
              size: content.length,
            },
          };
        } catch {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'x' };
        }
      },
      writeFile: async (
        file: string,
        content: string,
        expectedMtimeMs: number | null,
      ) => {
        if (expectedMtimeMs !== null) {
          const current = await fakeFiles().readFile(file);
          if (current.ok && Math.abs(current.value.mtimeMs - expectedMtimeMs) > 1) {
            return {
              ok: false as const,
              code: 'CONFLICT' as const,
              message: 'The file changed on disk since it was opened',
            };
          }
        }
        await writeFile(file, content, 'utf8');
        return {
          ok: true as const,
          value: { path: file, mtimeMs: Date.now(), size: content.length },
        };
      },
    };
  }

  it('does not write anything before the user accepts', async () => {
    const file = path.join(root, 'src', 'app.ts');
    const before = await readFile(file, 'utf8');
    // The proposal only exists; nothing was written.
    expect(before).toBe('const a = 1;\n');
  });

  it('writes the file when the proposal is accepted', async () => {
    const file = path.join(root, 'src', 'app.ts');
    const result = await writeProposal(
      {
        id: 'p1',
        runId: 'run-1',
        path: file,
        relativePath: 'src/app.ts',
        before: 'const a = 1;\n',
        after: 'const a = 2;\n',
        diff: '',
        expectedMtimeMs: null,
        created: false,
        createdAt: Date.now(),
      },
      root,
      fakeFiles() as never,
    );
    expect(result.ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('const a = 2;\n');
  });

  it('refuses a file that changed since the agent read it', async () => {
    const file = path.join(root, 'src', 'app.ts');
    const { stat } = await import('node:fs/promises');
    const info = await stat(file);
    const result = await writeProposal(
      {
        id: 'p1',
        runId: 'run-1',
        path: file,
        relativePath: 'src/app.ts',
        before: 'const a = 1;\n',
        after: 'const a = 2;\n',
        diff: '',
        // The agent read the file a moment ago.
        expectedMtimeMs: info.mtimeMs - 10000,
        created: false,
        createdAt: Date.now(),
      },
      root,
      fakeFiles() as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(true);
    }
    // The file was not touched.
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\n');
  });

  it('refuses a path outside the workspace', async () => {
    const result = await writeProposal(
      {
        id: 'p1',
        runId: 'run-1',
        path: path.join(root, '..', 'outside.ts'),
        relativePath: '../outside.ts',
        before: '',
        after: 'x',
        diff: '',
        expectedMtimeMs: null,
        created: true,
        createdAt: Date.now(),
      },
      root,
      fakeFiles() as never,
    );
    expect(result.ok).toBe(false);
  });
});
