/**
 * Tests for the context of a request (spec §10.2, §19.4).
 *
 * The context is built by the main process: the renderer only names the
 * files, so a file that is outside the workspace or that holds a secret
 * can never be sent.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildContext,
  previewContext,
  MAX_ATTACHMENT_CHARS,
} from '../../apps/desktop/src/main/providers/privacy';
import { parseGitignore } from '../../apps/desktop/src/main/services/gitignore';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-context-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'app.ts'),
    'line one\nline two\nline three\nline four\n',
    'utf8',
  );
  await writeFile(path.join(root, '.env'), 'SECRET=abc\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('context of a request', () => {
  it('sends only the selected lines of a selection', async () => {
    const context = await buildContext(
      root,
      [
        {
          path: path.join(root, 'src', 'app.ts'),
          kind: 'selection',
          startLine: 2,
          endLine: 3,
        },
      ],
      parseGitignore(''),
    );
    expect(context.text).toContain('line two');
    expect(context.text).toContain('line three');
    expect(context.text).not.toContain('line one');
    expect(context.text).not.toContain('line four');
    expect(context.attachments[0]?.kind).toBe('selection');
    expect(context.attachments[0]?.startLine).toBe(2);
  });

  it('sends the whole file when a file is attached', async () => {
    const context = await buildContext(
      root,
      [{ path: path.join(root, 'src', 'app.ts'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(context.text).toContain('line one');
    expect(context.text).toContain('line four');
  });

  it('never sends a file that holds a secret', async () => {
    const context = await buildContext(
      root,
      [{ path: path.join(root, '.env'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(context.text).toBe('');
    expect(context.skipped).toBe(1);
  });

  it('never sends a binary file', async () => {
    await writeFile(
      path.join(root, 'image.bin'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );
    const context = await buildContext(
      root,
      [{ path: path.join(root, 'image.bin'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(context.text).toBe('');
    expect(context.skipped).toBe(1);
  });
});

describe('preview of the context', () => {
  it('describes what will be sent', async () => {
    const previews = await previewContext(
      root,
      [{ path: path.join(root, 'src', 'app.ts'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(previews).toHaveLength(1);
    expect(previews[0]?.name).toBe('app.ts');
    expect(previews[0]?.tokens).toBeGreaterThan(0);
    expect(previews[0]?.truncated).toBe(false);
    expect(previews[0]?.skipped).toBeUndefined();
  });

  it('reports that a secret is not sent', async () => {
    const previews = await previewContext(
      root,
      [{ path: path.join(root, '.env'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(previews[0]?.skipped).toContain('never sent');
  });

  it('reports that a file is ignored', async () => {
    await writeFile(path.join(root, 'ignored.ts'), 'x\n', 'utf8');
    const previews = await previewContext(
      root,
      [{ path: path.join(root, 'ignored.ts'), kind: 'file' }],
      parseGitignore('ignored.ts\n'),
    );
    expect(previews[0]?.skipped).toContain('.gitignore');
  });

  it('reports that a binary file is not sent', async () => {
    await writeFile(
      path.join(root, 'image.bin'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );
    const previews = await previewContext(
      root,
      [{ path: path.join(root, 'image.bin'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(previews[0]?.skipped).toContain('binary');
  });

  it('reports that a file is shortened', async () => {
    await writeFile(
      path.join(root, 'big.ts'),
      'x'.repeat(MAX_ATTACHMENT_CHARS + 1000),
      'utf8',
    );
    const previews = await previewContext(
      root,
      [{ path: path.join(root, 'big.ts'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(previews[0]?.truncated).toBe(true);
    expect(previews[0]?.skipped).toContain('shortened');
  });

  it('ignores a path outside the workspace', async () => {
    const previews = await previewContext(
      root,
      [{ path: path.join(root, '..', 'outside.ts'), kind: 'file' }],
      parseGitignore(''),
    );
    expect(previews).toHaveLength(0);
  });
});
