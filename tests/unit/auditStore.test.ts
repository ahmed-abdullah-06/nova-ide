/**
 * Tests for the persistent audit history (milestone 6).
 *
 * The history holds metadata only, is bounded, and a corrupted file can
 * never inject an invalid entry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentAuditEntry } from '../../apps/desktop/src/shared/agent-types';
import { AuditStore } from '../../apps/desktop/src/main/agent/auditStore';

const directories: string[] = [];

async function temporaryFile(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-audit-'));
  directories.push(directory);
  return path.join(directory, 'agent-audit.json');
}

function entry(overrides: Partial<AgentAuditEntry> = {}): AgentAuditEntry {
  return {
    runId: 'run-1',
    step: 1,
    kind: 'run',
    summary: 'the run started',
    at: 1_700_000_000_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AuditStore', () => {
  it('keeps the history in memory when no file is given', () => {
    const store = new AuditStore();
    store.append(entry());
    expect(store.list()).toHaveLength(1);
  });

  it('persists the entries and reads them in a new instance', async () => {
    const file = await temporaryFile();
    const store = new AuditStore(file);
    store.append(entry({ step: 1 }));
    store.append(
      entry({
        step: 2,
        kind: 'tool',
        tool: 'read_file',
        decision: 'allow',
        summary: 'read src/a.ts',
      }),
    );
    await store.flush();

    const reopened = new AuditStore(file);
    expect(reopened.list()).toHaveLength(2);
    expect(reopened.list()[1]).toEqual({
      runId: 'run-1',
      step: 2,
      kind: 'tool',
      tool: 'read_file',
      decision: 'allow',
      summary: 'read src/a.ts',
      at: 1_700_000_000_000,
    });
  });

  it('drops the oldest entries above the cap', async () => {
    const file = await temporaryFile();
    const store = new AuditStore(file, 3);
    for (let step = 1; step <= 5; step += 1) {
      store.append(entry({ step }));
    }
    await store.flush();

    const reopened = new AuditStore(file, 3);
    expect(reopened.list().map((item) => item.step)).toEqual([3, 4, 5]);
  });

  it('starts empty when the file is not valid JSON', async () => {
    const file = await temporaryFile();
    await fs.writeFile(file, '{not json', 'utf8');
    const store = new AuditStore(file);
    expect(store.list()).toEqual([]);
    // A valid write replaces the broken file.
    store.append(entry());
    await store.flush();
    expect(new AuditStore(file).list()).toHaveLength(1);
  });

  it('ignores an invalid entry of a hand-edited file', async () => {
    const file = await temporaryFile();
    await fs.writeFile(
      file,
      JSON.stringify([
        entry(),
        { runId: 'run-1', step: 1, kind: 'evil', summary: 'x', at: 1 },
        { runId: 'run-1', step: 'one', kind: 'run', summary: 'x', at: 1 },
        { runId: 'run-1', step: 2, kind: 'run', summary: 'x', at: 1 },
        { runId: 'run-1', step: 3, kind: 'run', summary: 'x', at: 1 },
        { runId: 'run-1', step: 4, kind: 'run', summary: 'x', at: 1 },
        { runId: 'run-1', step: 5, kind: 'run', summary: 'x', at: 1 },
      ]),
      'utf8',
    );
    const store = new AuditStore(file);
    expect(store.list().map((item) => item.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never resets the history when append happens before a write', async () => {
    const file = await temporaryFile();
    const store = new AuditStore(file);
    store.append(entry({ step: 1 }));
    store.append(entry({ step: 2 }));
    await store.flush();
    expect(new AuditStore(file).list()).toHaveLength(2);
  });
});
