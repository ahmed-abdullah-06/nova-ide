/**
 * Workspace lifecycle service (spec §7, §18.1).
 *
 * Owns the active workspace and the Recent Workspaces list. The folder
 * picker is Electron's native dialog, always invoked from the main process.
 *
 * Persistence: recent entries (paths only — never file contents or
 * credentials) are stored as JSON in the Electron userData directory. The
 * SQLite/Prisma layer of spec §18 arrives with a later milestone; this
 * module keeps the same shape so migration is a storage swap.
 */
import { BrowserWindow, app, dialog } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FsResult,
  RecentWorkspace,
  Workspace,
} from '../../shared/ipc-types';
import { resolveWorkspaceRoot } from './pathSecurity';
import { errnoOf, fsOk } from './results';

/** How many recent workspaces are kept. */
const MAX_RECENT_WORKSPACES = 10;
const RECENT_FILE_NAME = 'recent-workspaces.json';

export class WorkspaceService {
  private active: Workspace | null = null;
  private recentCache: RecentWorkspace[] | null = null;

  getActive(): Workspace | null {
    return this.active;
  }

  /** Canonical root of the active workspace, or null. */
  getActiveRoot(): string | null {
    return this.active?.rootPath ?? null;
  }

  /**
   * Opens a workspace.
   * - no `pathValue` → native folder dialog (null result = user cancelled),
   * - with `pathValue` → validates that folder directly (Recent Workspaces).
   */
  async open(pathValue?: string): Promise<FsResult<Workspace | null>> {
    let candidate: string;

    if (pathValue === undefined) {
      const window =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        title: 'Open Folder',
        buttonLabel: 'Open Folder',
        properties: ['openDirectory', 'createDirectory'] as (
          | 'openDirectory'
          | 'createDirectory'
        )[],
      };
      const dialogResult = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);

      if (
        dialogResult.canceled ||
        dialogResult.filePaths.length === 0 ||
        dialogResult.filePaths[0] === undefined
      ) {
        return fsOk(null); // cancelled — not an error
      }
      candidate = dialogResult.filePaths[0];
    } else {
      candidate = pathValue;
    }

    const root = await resolveWorkspaceRoot(candidate);
    if (!root.ok) {
      return root;
    }

    const workspace: Workspace = {
      id: createHash('sha256').update(root.value).digest('hex').slice(0, 16),
      name: path.basename(root.value) || root.value,
      rootPath: root.value,
      lastOpenedAt: Date.now(),
      status: 'open',
    };

    this.active = workspace;
    await this.recordRecent(workspace);
    return fsOk(workspace);
  }

  /** Closes the active workspace (state only — editor state is renderer's). */
  close(): void {
    this.active = null;
  }

  /** Recent workspaces, most recent first (empty list never fails). */
  async recent(): Promise<RecentWorkspace[]> {
    return this.loadRecent();
  }

  /**
   * The workspace that is currently open.
   *
   * The renderer uses this to stay in sync with the main process (the
   * workspace may also have been changed from another window).
   */
  getActiveWorkspace(): FsResult<Workspace | null> {
    return fsOk<Workspace | null>(this.active);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private get recentFilePath(): string {
    return path.join(app.getPath('userData'), RECENT_FILE_NAME);
  }

  private async recordRecent(workspace: Workspace): Promise<void> {
    try {
      const current = await this.loadRecent();
      const entry: RecentWorkspace = {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.rootPath,
        lastOpenedAt: workspace.lastOpenedAt,
      };
      const next = [
        entry,
        ...current.filter((item) => item.rootPath !== entry.rootPath),
      ].slice(0, MAX_RECENT_WORKSPACES);

      await fs.mkdir(path.dirname(this.recentFilePath), { recursive: true });
      await fs.writeFile(
        this.recentFilePath,
        JSON.stringify(next, null, 2),
        'utf8',
      );
      this.recentCache = next;
    } catch (error) {
      // Recent history is best-effort; never block opening a workspace.
      console.error('[workspace] could not persist recent workspaces', error);
    }
  }

  private async loadRecent(): Promise<RecentWorkspace[]> {
    if (this.recentCache !== null) {
      return this.recentCache;
    }
    try {
      const raw = await fs.readFile(this.recentFilePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.recentCache = sanitizeRecent(parsed);
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        console.error('[workspace] could not read recent workspaces', error);
      }
      this.recentCache = [];
    }
    return this.recentCache;
  }
}

/** Accepts only well-formed entries (defends against a corrupted file). */
function sanitizeRecent(parsed: unknown): RecentWorkspace[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: RecentWorkspace[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.rootPath === 'string' &&
      typeof record.name === 'string' &&
      typeof record.id === 'string' &&
      typeof record.lastOpenedAt === 'number'
    ) {
      entries.push({
        id: record.id,
        name: record.name,
        rootPath: record.rootPath,
        lastOpenedAt: record.lastOpenedAt,
      });
    }
    if (entries.length >= MAX_RECENT_WORKSPACES) {
      break;
    }
  }
  return entries;
}
