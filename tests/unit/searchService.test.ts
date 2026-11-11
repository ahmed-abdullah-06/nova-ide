/**
 * Search service tests (spec §7, §21).
 *
 * The real service is exercised against a real workspace directory, so the
 * ignore rules, the result limits and the cancellation are verified against
 * the actual filesystem.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SEARCH_RESULTS,
  SEARCH_BATCH_SIZE,
  SearchService,
  truncatePreview,
} from '../../apps/desktop/src/main/services/searchService';
import {
  EMPTY_GITIGNORE,
  parseGitignore,
  toPosixPath,
} from '../../apps/desktop/src/main/services/gitignore';

let root = '';
let service: SearchService | null = null;
const results: { requestId: string; matches: unknown[]; done: boolean }[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-search-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.ts'), 'const needle = 1;\n', 'utf8');
  await writeFile(
    path.join(root, 'src', 'other.ts'),
    'const value = 2;\n// needle again\n',
    'utf8',
  );
  await writeFile(path.join(root, 'README.md'), '# needle docs\n', 'utf8');
  await writeFile(
    path.join(root, 'node_modules', 'pkg', 'index.js'),
    'const needle = 3;\n',
    'utf8',
  );
  results.length = 0;
  service = new SearchService({
    getRoot: () => root,
    onResults: (payload) => {
      results.push({
        requestId: payload.requestId,
        matches: payload.matches,
        done: payload.done,
      });
    },
  });
});

afterEach(async () => {
  service = null;
  await rm(root, { recursive: true, force: true });
});

/** Waits for the final result batch of a request. */
async function waitForResult(
  requestId: string,
  timeoutMs = 15000,
): Promise<{ matches: unknown[]; done: boolean } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // The results arrive in batches; the final one is marked as done.
    const found = results
      .filter((entry) => entry.requestId === requestId)
      .find((entry) => entry.done === true);
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

/** Collects every match of a request (the batches are cumulative). */
async function collectMatches(
  requestId: string,
  timeoutMs = 15000,
): Promise<unknown[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const batches = results.filter((entry) => entry.requestId === requestId);
    if (batches.some((entry) => entry.done === true)) {
      return batches.flatMap((entry) => entry.matches);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

describe('gitignore matcher', () => {
  it('ignores nothing for an empty matcher', () => {
    expect(EMPTY_GITIGNORE.ignores('any/file.js', false)).toBe(false);
  });

  it('matches a simple file pattern anywhere in the tree', () => {
    const matcher = parseGitignore('*.log');
    expect(matcher.ignores('debug.log', false)).toBe(true);
    expect(matcher.ignores('nested/debug.log', false)).toBe(true);
    expect(matcher.ignores('debug.txt', false)).toBe(false);
  });

  it('anchors a pattern that contains a slash', () => {
    const matcher = parseGitignore('/build');
    expect(matcher.ignores('build', true)).toBe(true);
    expect(matcher.ignores('nested/build', true)).toBe(false);
  });

  it('respects a negation', () => {
    const matcher = parseGitignore('*.log\n!keep.log');
    expect(matcher.ignores('drop.log', false)).toBe(true);
    expect(matcher.ignores('keep.log', false)).toBe(false);
  });

  it('only matches directories for a trailing slash', () => {
    const matcher = parseGitignore('cache/');
    expect(matcher.ignores('cache', true)).toBe(true);
    expect(matcher.ignores('cache', false)).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const matcher = parseGitignore('# a comment\n\n');
    expect(matcher.ignores('anything', false)).toBe(false);
  });

  it('normalises Windows separators', () => {
    expect(toPosixPath('a\\b\\c')).toBe('a/b/c');
  });
});

describe('search service', () => {
  it('refuses to search without a workspace', () => {
    const withoutWorkspace = new SearchService({
      getRoot: () => null,
      onResults: () => undefined,
    });
    const result = withoutWorkspace.query('r1', 'files', 'needle');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_WORKSPACE');
    }
  });

  it('refuses an empty pattern', () => {
    const result = service?.query('r1', 'files', '');
    expect(result?.ok).toBe(false);
  });

  it('finds files by name', async () => {
    const accepted = service?.query('r1', 'files', 'app.ts');
    expect(accepted?.ok).toBe(true);
    const batch = await waitForResult('r1');
    expect(batch).not.toBeNull();
    const names = (batch?.matches as { name: string }[]).map((m) => m.name);
    expect(names).toContain('app.ts');
  });

  it('finds content matches with line and column', async () => {
    const accepted = service?.query('r2', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const batch = await waitForResult('r2');
    expect(batch).not.toBeNull();
    const matches = (await collectMatches('r2')) as {
      name: string;
      line: number;
      column: number;
    }[];
    const appMatch = matches.find((match) => match.name === 'app.ts');
    expect(appMatch?.line).toBe(1);
    expect(appMatch?.column).toBe(7);
  });

  it('never searches node_modules', async () => {
    const accepted = service?.query('r3', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const paths = (await collectMatches('r3')).map(
      (m) => (m as { path: string }).path,
    );
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('respects the .gitignore of the workspace', async () => {
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n', 'utf8');
    await writeFile(path.join(root, 'ignored.ts'), 'const needle = 9;\n', 'utf8');
    const accepted = service?.query('r4', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const paths = (await collectMatches('r4')).map(
      (m) => (m as { path: string }).path,
    );
    expect(paths.some((p) => p.endsWith('ignored.ts'))).toBe(false);
  });

  it('skips binary files', async () => {
    await writeFile(
      path.join(root, 'binary.dat'),
      Buffer.from([0x00, 0x01, 0x02, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]),
    );
    const accepted = service?.query('r5', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const paths = (await collectMatches('r5')).map(
      (m) => (m as { path: string }).path,
    );
    expect(paths.some((p) => p.endsWith('binary.dat'))).toBe(false);
  });

  it('stops at the result limit', async () => {
    // More files than the limit allows.
    for (let index = 0; index < MAX_SEARCH_RESULTS + 20; index += 1) {
      await writeFile(
        path.join(root, 'src', `file-${index}.ts`),
        'const needle = 1;\n',
        'utf8',
      );
    }
    const accepted = service?.query('r6', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const matches = await collectMatches('r6', 30000);
    expect(matches.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
    expect(matches.length).toBeGreaterThan(0);
  }, 40000);

  it('cancels a running search', async () => {
    const accepted = service?.query('r7', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    const cancelled = service?.cancel('r7');
    expect(cancelled?.ok).toBe(true);
    // Cancelling never throws, even for an unknown request.
    expect(service?.cancel('unknown').ok).toBe(true);
  });

  it('delivers the results in batches', async () => {
    // More files than one batch can hold.
    for (let index = 0; index < SEARCH_BATCH_SIZE + 20; index += 1) {
      await writeFile(
        path.join(root, 'src', `batch-${index}.ts`),
        'const needle = 1;\n',
        'utf8',
      );
    }
    const accepted = service?.query('r9', 'content', 'needle');
    expect(accepted?.ok).toBe(true);
    await waitForResult('r9', 30000);
    const batches = results.filter((entry) => entry.requestId === 'r9');
    // At least one intermediate batch and one final batch.
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.filter((entry) => entry.done === false).length).toBeGreaterThan(0);
    expect(batches[batches.length - 1]?.done).toBe(true);
  }, 40000);

  it('refuses to run the same request twice', () => {
    const first = service?.query('r8', 'files', 'a');
    expect(first?.ok).toBe(true);
    const second = service?.query('r8', 'files', 'b');
    expect(second?.ok).toBe(false);
  });
});

describe('preview truncation', () => {
  it('keeps short lines unchanged', () => {
    expect(truncatePreview('short line')).toBe('short line');
  });

  it('shortens long lines', () => {
    const preview = truncatePreview('x'.repeat(500));
    expect(preview.length).toBeLessThanOrEqual(200);
  });
});
