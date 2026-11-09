/**
 * External modification watcher for files open in the editor (spec §7.1).
 *
 * Only files the renderer explicitly registers are watched — never a
 * recursive workspace scan (spec §21: no full-disk indexing in M2).
 * `fs.watchFile` polls with a 1 s interval; for the handful of open buffers
 * this is cheap, portable across Windows/Linux/macOS, and immune to the
 * platform quirks of `fs.watch` on network/remote filesystems.
 */
import { promises as fs, unwatchFile, watchFile, type Stats } from 'node:fs';
import type { ExternalChange } from '../../shared/ipc-types';

const POLL_INTERVAL_MS = 1000;

export class OpenFileWatcher {
  /** Canonical path → last observed modification time (0 = missing). */
  private readonly watched = new Map<string, number>();

  constructor(private readonly emit: (change: ExternalChange) => void) {}

  /**
   * Reconciles the watch set with the renderer's open files: unwatched
   * paths are dropped, new paths are stat'ed so our own writes never look
   * like external changes.
   */
  async sync(paths: readonly string[]): Promise<number> {
    const next = new Set(paths);

    for (const existing of [...this.watched.keys()]) {
      if (!next.has(existing)) {
        unwatchFile(existing);
        this.watched.delete(existing);
      }
    }

    for (const candidate of next) {
      if (this.watched.has(candidate)) {
        continue;
      }
      let mtimeMs = 0;
      try {
        const statResult: Stats = await fs.stat(candidate);
        mtimeMs = statResult.mtimeMs;
      } catch {
        // Missing files stay watched so a re-creation is reported too.
        mtimeMs = 0;
      }
      this.watched.set(candidate, mtimeMs);
      watchFile(candidate, { interval: POLL_INTERVAL_MS }, (current, previous) => {
        this.handleTick(candidate, current, previous);
      });
    }

    return this.watched.size;
  }

  /** Stops watching everything (used when a workspace closes). */
  clear(): void {
    for (const path of this.watched.keys()) {
      unwatchFile(path);
    }
    this.watched.clear();
  }

  private handleTick(path: string, current: Stats, previous: Stats): void {
    const known = this.watched.get(path);
    if (known === undefined) {
      return;
    }
    // Poll fired without a real modification (e.g. first tick after watch
    // registration on some platforms) — ignore it.
    if (current.mtimeMs === previous.mtimeMs && current.mtimeMs === known) {
      return;
    }
    if (current.mtimeMs === known) {
      return;
    }

    this.watched.set(path, current.mtimeMs);

    if (current.mtimeMs === 0 || current.nlink === 0) {
      this.emit({ path, kind: 'missing', mtimeMs: null });
      return;
    }
    this.emit({ path, kind: 'changed', mtimeMs: current.mtimeMs });
  }
}
