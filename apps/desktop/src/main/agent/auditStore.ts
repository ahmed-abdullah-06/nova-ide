/**
 * The persistent audit history of the agent (spec §19.4, milestone 6).
 *
 * The history holds metadata only: the kind of the action, the tool, the
 * decision, a short redacted summary and a timestamp. It never holds the
 * content of a file, a secret or the reasoning of the model.
 *
 * The file is bounded (the oldest entries are dropped) and a corrupted or
 * hand-edited file can never inject anything: every entry is validated
 * field by field and an invalid entry is ignored.
 */
import { promises as fs, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentAuditEntry } from '../../shared/agent-types';

/** The default maximum number of entries. */
export const MAX_AUDIT_ENTRIES = 500;

/** The maximum size of the file that is read. */
const MAX_AUDIT_FILE_BYTES = 1024 * 1024;

/** The kinds of an entry. */
const KINDS = new Set<AgentAuditEntry['kind']>([
  'tool',
  'permission',
  'approval',
  'proposal',
  'run',
  'command',
]);

export class AuditStore {
  private readonly filePath: string | null;
  private readonly maxEntries: number;
  private entries: AgentAuditEntry[] = [];
  /** The queue of the writes, so they never interleave. */
  private pending: Promise<void> = Promise.resolve();

  /**
   * @param filePath The file of the history (null keeps it in memory).
   * @param maxEntries The maximum number of entries.
   */
  constructor(filePath: string | null = null, maxEntries = MAX_AUDIT_ENTRIES) {
    this.filePath = filePath;
    this.maxEntries = Math.max(1, maxEntries);
    this.entries = this.readSync();
  }

  /** The entries, oldest first. */
  list(): AgentAuditEntry[] {
    return [...this.entries];
  }

  /**
   * Appends one entry and writes the file in the background.
   *
   * The in-memory list is updated at once, so the renderer sees the entry
   * even if the disk is slow.
   */
  append(entry: AgentAuditEntry): void {
    this.entries = [...this.entries, entry].slice(-this.maxEntries);
    this.scheduleWrite();
  }

  /** Waits until every scheduled write is done (the application quits). */
  async flush(): Promise<void> {
    await this.pending;
  }

  /** Reads the file synchronously (a small, bounded file). */
  private readSync(): AgentAuditEntry[] {
    if (this.filePath === null) {
      return [];
    }
    try {
      const stat = statSync(this.filePath);
      if (!stat.isFile() || stat.size > MAX_AUDIT_FILE_BYTES) {
        return [];
      }
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      const entries: AgentAuditEntry[] = [];
      for (const raw of parsed) {
        const entry = parseEntry(raw);
        if (entry !== null) {
          entries.push(entry);
        }
      }
      return entries.slice(-this.maxEntries);
    } catch {
      // No file yet, or the file is not valid JSON: start empty.
      return [];
    }
  }

  /** Queues a write of the whole (bounded) list. */
  private scheduleWrite(): void {
    if (this.filePath === null) {
      return;
    }
    const filePath = this.filePath;
    const payload = JSON.stringify(this.entries);
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          const temporary = `${filePath}.tmp`;
          await fs.writeFile(temporary, payload, 'utf8');
          await fs.rename(temporary, filePath);
        } catch (error) {
          console.error(
            '[agent] the audit history could not be written:',
            error instanceof Error ? error.message : 'unknown error',
          );
        }
      });
  }
}

/** Validates one entry of the file (a corrupted entry is ignored). */
function parseEntry(value: unknown): AgentAuditEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.runId !== 'string' ||
    record.runId.length > 128 ||
    typeof record.step !== 'number' ||
    !Number.isFinite(record.step) ||
    typeof record.kind !== 'string' ||
    !KINDS.has(record.kind as AgentAuditEntry['kind']) ||
    typeof record.summary !== 'string' ||
    record.summary.length > 400 ||
    typeof record.at !== 'number' ||
    !Number.isFinite(record.at)
  ) {
    return null;
  }
  if (
    (record.tool !== undefined && typeof record.tool !== 'string') ||
    (record.decision !== undefined && typeof record.decision !== 'string')
  ) {
    return null;
  }
  const entry: AgentAuditEntry = {
    runId: record.runId,
    step: record.step,
    kind: record.kind as AgentAuditEntry['kind'],
    summary: record.summary,
    at: record.at,
  };
  if (typeof record.tool === 'string') {
    entry.tool = record.tool.slice(0, 128);
  }
  if (typeof record.decision === 'string') {
    entry.decision = record.decision.slice(0, 128);
  }
  return entry;
}
