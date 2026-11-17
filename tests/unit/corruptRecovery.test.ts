/**
 * Corrupted-file recovery (Milestone 10B).
 * A corrupt store must be backed up, never silently deleted or trusted.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJsonWithBackup } from '../../apps/desktop/src/main/config/corruptRecovery';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'nova-recovery-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readJsonWithBackup', () => {
  it('returns the fallback without a backup when the file is missing', async () => {
    const result = await readJsonWithBackup(
      path.join(dir, 'missing.json'), 'settings', (parsed) => parsed, { safe: true }, 'test',
    );
    expect(result).toEqual({ value: { safe: true }, backedUp: false });
    expect(await readdir(dir)).toEqual([]);
  });

  it('backs up a file with invalid JSON and keeps its bytes', async () => {
    const file = path.join(dir, 'app-settings.json');
    await writeFile(file, '{ this is not json', 'utf8');
    const result = await readJsonWithBackup(
      file, 'settings', (parsed) => parsed, { safe: false }, 'test',
    );
    expect(result.backedUp).toBe(true);
    expect(result.value).toEqual({ safe: false });
    const backups = (await readdir(dir)).filter((name) => name.includes('.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(dir, backups[0] as string), 'utf8')).toBe('{ this is not json');
  });

  it('backs up valid JSON with the wrong top-level shape', async () => {
    const file = path.join(dir, 'conversations.json');
    await writeFile(file, JSON.stringify({ unexpected: true }), 'utf8');
    const result = await readJsonWithBackup(
      file, 'conversations', (parsed) => parsed, [], 'test',
    );
    expect(result.backedUp).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('returns the sanitized value for a valid file and leaves it in place', async () => {
    const file = path.join(dir, 'app-settings.json');
    await writeFile(file, JSON.stringify({ version: 1, settings: { localOnly: true } }), 'utf8');
    const result = await readJsonWithBackup(
      file, 'settings', (parsed) => (parsed as { settings: { localOnly: boolean } }).settings,
      { localOnly: false }, 'test',
    );
    expect(result).toEqual({ value: { localOnly: true }, backedUp: false });
    expect(await readdir(dir)).toEqual(['app-settings.json']);
  });

  it('accepts an array file when the expected key is null', async () => {
    const file = path.join(dir, 'recent.json');
    await writeFile(file, JSON.stringify([{ rootPath: 'C:\\work' }]), 'utf8');
    const result = await readJsonWithBackup(
      file, null, (parsed) => parsed as unknown[], [], 'test',
    );
    expect(result.value).toHaveLength(1);
    expect(result.backedUp).toBe(false);
  });
});
