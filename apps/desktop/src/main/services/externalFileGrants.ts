/**
 * In-memory grants for files opened outside the workspace.
 *
 * A grant binds one opaque id to exactly one canonical path. The renderer can
 * only send the id — never a path — and the main process re-verifies that the
 * path still resolves to the same canonical file at every use. Grants live
 * only for the lifetime of the process; nothing is written to disk.
 */
import { randomUUID } from 'node:crypto';
import type { FsResult } from '../../shared/ipc-types';
import { relateToRoot, resolveMainProcessFile } from './pathSecurity';
import { fsFail, fsOk } from './results';

export class ExternalFileGrants {
  private readonly byId = new Map<string, string>();
  private readonly byPath = new Map<string, string>();

  /** Number of live grants (for diagnostics only; no file details leak). */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Grants a canonical path selected by the user. Repeated selection of the
   * same file reuses its id instead of accumulating duplicate grants.
   */
  issue(canonicalPath: string): string {
    const existing = this.byPath.get(canonicalPath);
    if (existing !== undefined) {
      return existing;
    }
    const id = randomUUID();
    this.byId.set(id, canonicalPath);
    this.byPath.set(canonicalPath, id);
    return id;
  }

  /**
   * Resolves a grant id to its exact canonical path. Unknown ids are refused,
   * and a path that changed identity on disk (e.g. a symlink swapped in after
   * the grant) is refused as well.
   */
  async resolve(grantId: unknown): Promise<FsResult<string>> {
    if (typeof grantId !== 'string' || grantId.length === 0) {
      return fsFail('INVALID_PATH', 'Unknown file grant');
    }
    const granted = this.byId.get(grantId);
    if (granted === undefined) {
      return fsFail('INVALID_PATH', 'Unknown file grant');
    }
    const current = await resolveMainProcessFile(granted);
    if (!current.ok) {
      return current;
    }
    if (relateToRoot(granted, current.value) !== 'root') {
      return fsFail('INVALID_PATH', 'The granted file changed on disk');
    }
    return fsOk(current.value);
  }

  /** Drops every grant (used by tests and process teardown). */
  clear(): void {
    this.byId.clear();
    this.byPath.clear();
  }
}
