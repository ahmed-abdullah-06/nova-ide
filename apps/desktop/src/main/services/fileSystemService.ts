/**
 * Workspace-scoped filesystem service (spec §7, §19.3, §21).
 *
 * Every public method:
 *  1. verifies there is an active, still-existing workspace root,
 *  2. resolves the requested path through `resolveInWorkspace` immediately
 *     before touching the disk (canonical path + containment check),
 *  3. performs the operation,
 *  4. returns a structured `FsResult` — it never throws across IPC.
 *
 * The renderer has no direct access to this module or to any Node.js API;
 * it only sees the narrow `NovaFsApi` preload bridge.
 */
import { dialog, BrowserWindow } from 'electron';
import { promises as fs, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';
import type {
  DirListing,
  FileContent,
  FileEntry,
  FileKind,
  FsResult,
  SaveReceipt,
} from '../../shared/ipc-types';
import type { OpenFileWatcher } from './fileWatcher';
import { isValidEntryName, relateToRoot, resolveInWorkspace } from './pathSecurity';
import { errnoOf, fsFail, fsOk, mapFsError } from './results';

/** Maximum entries returned for one directory (renderer shows a notice). */
const MAX_DIR_ENTRIES = 2000;
/** Safety cap while collecting a pathological directory (100k+ entries). */
const MAX_COLLECTED_ENTRIES = 20000;
/** Largest file NOVA opens as text. */
const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
/** Largest payload written through a save. */
const MAX_WRITE_BYTES = 50 * 1024 * 1024;
/** Bytes inspected for NUL characters when detecting binary files. */
const BINARY_SNIFF_BYTES = 8000;
/** Watched open files (bounded so a runaway renderer cannot pin the FS). */
const MAX_WATCHED_FILES = 500;
/** mtime tolerance when detecting external modifications. */
const MTIME_TOLERANCE_MS = 1;

export class FileSystemService {
  constructor(
    private readonly getRoot: () => string | null,
    private readonly watcher: OpenFileWatcher,
  ) {}

  // -------------------------------------------------------------------------
  // Workspace guard
  // -------------------------------------------------------------------------

  /** Confirms an active workspace root still exists on disk. */
  private async requireRoot(): Promise<FsResult<string>> {
    const root = this.getRoot();
    if (!root) {
      return fsFail('NO_WORKSPACE', 'No folder is open');
    }
    try {
      await fs.stat(root);
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') {
        return fsFail('WORKSPACE_MISSING', 'The workspace folder is no longer available');
      }
      return mapFsError(error, 'Cannot access workspace folder');
    }
    return fsOk(root);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** Lists ONE directory level (never recursive, spec §21). */
  async readDirectory(dirPath: string): Promise<FsResult<DirListing>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const resolved = await resolveInWorkspace(rootResult.value, dirPath, {
      mustExist: true,
    });
    if (!resolved.ok) {
      return resolved;
    }

    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(resolved.value, { withFileTypes: true });
    } catch (error) {
      const errno = errnoOf(error);
      if (errno === 'ENOENT') {
        return fsFail('NOT_FOUND', 'Folder does not exist');
      }
      if (errno === 'ENOTDIR') {
        return fsFail('NOT_A_DIRECTORY', 'Path is not a folder');
      }
      if (errno === 'EACCES' || errno === 'EPERM') {
        return fsFail('PERMISSION_DENIED', 'Cannot read folder: permission denied');
      }
      return mapFsError(error, 'Cannot read folder');
    }

    const considered = dirents.slice(0, MAX_COLLECTED_ENTRIES);
    const entries: FileEntry[] = [];

    for (const dirent of considered) {
      const kind = await this.entryKind(resolved.value, dirent);
      if (kind === null) {
        continue; // sockets, fifos, devices — not editable content
      }
      entries.push({
        name: dirent.name,
        path: path.join(resolved.value, dirent.name),
        kind,
      });
    }

    entries.sort(compareEntries);

    const truncated = dirents.length > MAX_DIR_ENTRIES;
    return fsOk({
      entries: truncated ? entries.slice(0, MAX_DIR_ENTRIES) : entries,
      truncated,
    });
  }

  /** Determines the display kind of an entry (symlinks are stat'ed). */
  private async entryKind(
    dirPath: string,
    dirent: Dirent,
  ): Promise<FileKind | null> {
    if (dirent.isSymbolicLink()) {
      try {
        const stat = await fs.stat(path.join(dirPath, dirent.name));
        return stat.isDirectory() ? 'directory' : 'file';
      } catch {
        // Broken link: shown as a file; opening it reports NOT_FOUND.
        return 'file';
      }
    }
    if (dirent.isDirectory()) {
      return 'directory';
    }
    if (dirent.isFile()) {
      return 'file';
    }
    return null;
  }

  /** Reads a text file; binary/unsupported content is rejected up-front. */
  async readFile(filePath: string): Promise<FsResult<FileContent>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    // The root is allowed through resolution so that opening it reports
    // IS_DIRECTORY ("cannot open a folder as a file") — it can never be
    // read as content because the stat check below rejects directories.
    const resolved = await resolveInWorkspace(rootResult.value, filePath, {
      mustExist: true,
    });
    if (!resolved.ok) {
      return resolved;
    }

    let stat: Stats;
    try {
      stat = await fs.stat(resolved.value);
    } catch (error) {
      return mapFsError(error, 'Cannot open file');
    }
    if (stat.isDirectory()) {
      return fsFail('IS_DIRECTORY', 'Cannot open a folder as a file');
    }
    if (!stat.isFile()) {
      return fsFail('INVALID_PATH', 'Unsupported file type');
    }
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return fsFail(
        'FILE_TOO_LARGE',
        `File is larger than ${Math.round(MAX_TEXT_FILE_BYTES / (1024 * 1024))} MB and cannot be opened`,
      );
    }

    // Captured BEFORE the read so saves can detect concurrent modifications.
    const mtimeMs = stat.mtimeMs;

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolved.value);
    } catch (error) {
      return mapFsError(error, 'Cannot read file');
    }

    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return fsFail('BINARY_FILE', 'Cannot open file: it is a binary file');
    }

    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return fsFail(
        'BINARY_FILE',
        'Cannot open file: unsupported or binary encoding',
      );
    }

    return fsOk({
      path: resolved.value,
      content,
      mtimeMs,
      size: stat.size,
    });
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Saves a buffer. `expectedMtimeMs === null` forces the write; otherwise
   * the disk must still match what the renderer last saw, otherwise a
   * structured conflict is returned (never silently overwrite, spec §6/§7).
   */
  async writeFile(
    filePath: string,
    content: string,
    expectedMtimeMs: number | null,
  ): Promise<FsResult<SaveReceipt>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const resolved = await resolveInWorkspace(rootResult.value, filePath, {
      allowRoot: false,
    });
    if (!resolved.ok) {
      return resolved;
    }
    return this.writeCanonical(resolved.value, content, expectedMtimeMs);
  }

  /** Native Save-As dialog; the chosen path must stay inside the workspace. */
  async saveAs(
    suggestedPath: string | null,
    content: string,
  ): Promise<FsResult<SaveReceipt | null>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const root = rootResult.value;

    let defaultPath = path.join(root, 'untitled.txt');
    if (suggestedPath !== null) {
      const suggestion = await resolveInWorkspace(root, suggestedPath, {
        allowRoot: false,
      });
      if (suggestion.ok) {
        defaultPath = suggestion.value;
      }
    }

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Save As',
      buttonLabel: 'Save',
      defaultPath,
      properties: ['createDirectory', 'showOverwriteConfirmation'] as (
        | 'createDirectory'
        | 'showOverwriteConfirmation'
      )[],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    };
    const dialogResult = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);

    if (dialogResult.canceled || dialogResult.filePath === undefined) {
      return fsOk(null);
    }

    const resolved = await resolveInWorkspace(root, dialogResult.filePath, {
      allowRoot: false,
    });
    if (!resolved.ok) {
      return resolved; // e.g. the user picked a location outside the workspace
    }
    return this.writeCanonical(resolved.value, content, null);
  }

  /** Shared write path (already resolved + contained). */
  private async writeCanonical(
    canonicalPath: string,
    content: string,
    expectedMtimeMs: number | null,
  ): Promise<FsResult<SaveReceipt>> {
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      return fsFail('FILE_TOO_LARGE', 'Content is too large to save');
    }

    // Stat unconditionally: saving over a folder must be refused whether or
    // not the caller supplied an expected mtime (force saves included).
    let current: Stats | null = null;
    try {
      current = await fs.stat(canonicalPath);
    } catch (error) {
      const errno = errnoOf(error);
      if (errno === 'ENOENT') {
        if (expectedMtimeMs !== null) {
          return fsFail('NOT_FOUND', 'The file no longer exists on disk');
        }
        // Force save of a not-yet-existing file: fall through to the write.
      } else if (errno === 'ENOTDIR') {
        return fsFail('INVALID_PATH', 'Path component is not a directory');
      } else {
        return mapFsError(error, 'Cannot save file');
      }
    }

    if (current !== null) {
      if (current.isDirectory()) {
        return fsFail('IS_DIRECTORY', 'Cannot save over a folder');
      }
      if (
        expectedMtimeMs !== null &&
        Math.abs(current.mtimeMs - expectedMtimeMs) > MTIME_TOLERANCE_MS
      ) {
        return fsFail(
          'CONFLICT',
          'The file changed on disk since it was opened',
        );
      }
    }

    try {
      await fs.writeFile(canonicalPath, content, { encoding: 'utf8' });
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') {
        return fsFail('NOT_FOUND', 'The folder containing this file no longer exists');
      }
      return mapFsError(error, 'Cannot save file');
    }

    try {
      const after = await fs.stat(canonicalPath);
      return fsOk({ path: canonicalPath, mtimeMs: after.mtimeMs });
    } catch (error) {
      return mapFsError(error, 'Cannot save file');
    }
  }

  // -------------------------------------------------------------------------
  // Create / rename / delete
  // -------------------------------------------------------------------------

  async createFile(filePath: string): Promise<FsResult<FileEntry>> {
    return this.createEntry(filePath, 'file');
  }

  async createFolder(folderPath: string): Promise<FsResult<FileEntry>> {
    return this.createEntry(folderPath, 'directory');
  }

  private async createEntry(
    targetPath: string,
    kind: FileKind,
  ): Promise<FsResult<FileEntry>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const root = rootResult.value;

    const requestedName = path.basename(path.normalize(targetPath));
    if (!isValidEntryName(requestedName)) {
      return fsFail('INVALID_NAME', 'Invalid file or folder name');
    }

    const resolved = await resolveInWorkspace(root, targetPath, {
      allowRoot: false,
    });
    if (!resolved.ok) {
      return resolved;
    }

    // Parent must already exist (no implicit directory creation).
    const parent = path.dirname(resolved.value);
    let parentStat: Stats;
    try {
      parentStat = await fs.stat(parent);
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') {
        return fsFail('NOT_FOUND', 'The destination folder does not exist');
      }
      return mapFsError(error, 'Cannot create item');
    }
    if (!parentStat.isDirectory()) {
      return fsFail('NOT_A_DIRECTORY', 'The destination is not a folder');
    }

    try {
      await fs.lstat(resolved.value);
      return fsFail('ALREADY_EXISTS', `An item named "${requestedName}" already exists`);
    } catch {
      // Free name — continue.
    }

    try {
      if (kind === 'directory') {
        await fs.mkdir(resolved.value);
      } else {
        // 'wx' → create only if missing (atomic against races).
        await fs.writeFile(resolved.value, '', { encoding: 'utf8', flag: 'wx' });
      }
    } catch (error) {
      if (errnoOf(error) === 'EEXIST') {
        return fsFail('ALREADY_EXISTS', `An item named "${requestedName}" already exists`);
      }
      return mapFsError(error, kind === 'directory' ? 'Cannot create folder' : 'Cannot create file');
    }

    return fsOk({ name: requestedName, path: resolved.value, kind });
  }

  /** Renames within the same parent directory (bare new name, no separators). */
  async rename(itemPath: string, newName: string): Promise<FsResult<FileEntry>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const root = rootResult.value;

    if (!isValidEntryName(newName)) {
      return fsFail('INVALID_NAME', 'Invalid file or folder name');
    }

    // Revalidate the source immediately before mutating the filesystem.
    const resolved = await resolveInWorkspace(root, itemPath, {
      allowRoot: false,
      mustExist: true,
    });
    if (!resolved.ok) {
      return resolved;
    }

    let sourceStat: Stats;
    try {
      sourceStat = await fs.lstat(resolved.value);
    } catch (error) {
      return mapFsError(error, 'Cannot rename item');
    }

    const currentName = path.basename(resolved.value);
    if (newName === currentName) {
      // No-op rename (identical name) — report success with the same entry.
      return fsOk({
        name: currentName,
        path: resolved.value,
        kind: sourceStat.isDirectory() ? 'directory' : 'file',
      });
    }

    const parent = path.dirname(resolved.value);
    const target = path.join(parent, newName);

    // Belt-and-braces: the computed target must remain inside the workspace.
    const relation = relateToRoot(root, target);
    if (relation === 'outside') {
      return fsFail('OUTSIDE_WORKSPACE', 'Path is outside the active workspace');
    }
    if (relation === 'root') {
      return fsFail('ROOT_PROTECTED', 'The workspace root cannot be renamed');
    }

    // Case-only renames are legal on Windows: skip the existence probe when
    // the target refers to the same entry ignoring case.
    const sameEntry =
      process.platform === 'win32'
        ? target.toLowerCase() === resolved.value.toLowerCase()
        : target === resolved.value;

    if (!sameEntry) {
      try {
        await fs.lstat(target);
        return fsFail('ALREADY_EXISTS', `An item named "${newName}" already exists`);
      } catch {
        // Target name is free.
      }
    }

    try {
      await fs.rename(resolved.value, target);
    } catch (error) {
      const errno = errnoOf(error);
      if (errno === 'ENOENT') {
        return fsFail('NOT_FOUND', 'The item no longer exists');
      }
      if (errno === 'EEXIST' || errno === 'ENOTEMPTY') {
        return fsFail('ALREADY_EXISTS', `An item named "${newName}" already exists`);
      }
      return mapFsError(error, 'Cannot rename item');
    }

    let targetStat: Stats;
    try {
      targetStat = await fs.stat(target);
    } catch (error) {
      return mapFsError(error, 'Cannot rename item');
    }

    return fsOk({
      name: newName,
      path: target,
      kind: targetStat.isDirectory() ? 'directory' : 'file',
    });
  }

  /**
   * Deletes a file or folder. The caller MUST have shown an explicit
   * confirmation dialog (spec §6/§7 — no silent recursive deletion).
   * A symbolic link is unlinked itself; its target is never touched.
   */
  async delete(itemPath: string): Promise<FsResult<{ path: string }>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }
    const root = rootResult.value;

    if (typeof itemPath !== 'string' || itemPath.length === 0 || itemPath.includes('\0')) {
      return fsFail('INVALID_PATH', 'Path must be a non-empty string');
    }

    const absolute = path.resolve(itemPath);

    // The root itself is protected: its PARENT is outside the workspace, so
    // without this check the refusal would (technically correctly, but
    // unhelpfully) read OUTSIDE_WORKSPACE instead of ROOT_PROTECTED.
    if (relateToRoot(root, absolute) === 'root') {
      return fsFail('ROOT_PROTECTED', 'The workspace root cannot be deleted');
    }

    // Resolve only the PARENT canonically so a symlink leaf is deleted as a
    // link instead of resolving to (and removing) its target.
    const parentResult = await resolveInWorkspace(root, path.dirname(absolute), {
      mustExist: true,
    });
    if (!parentResult.ok) {
      return parentResult;
    }

    const name = path.basename(absolute);
    if (!isValidEntryName(name)) {
      return fsFail('INVALID_NAME', 'Invalid file or folder name');
    }

    const target = path.join(parentResult.value, name);
    const relation = relateToRoot(root, target);
    if (relation !== 'inside') {
      return fsFail('ROOT_PROTECTED', 'The workspace root cannot be deleted');
    }

    let stat: Stats;
    try {
      stat = await fs.lstat(target); // never follow the leaf
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') {
        return fsFail('NOT_FOUND', 'The item no longer exists');
      }
      return mapFsError(error, 'Cannot delete item');
    }

    // Revalidated immediately before the destructive operation.
    try {
      if (stat.isSymbolicLink()) {
        await fs.unlink(target);
      } else {
        await fs.rm(target, {
          recursive: true,
          force: false,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    } catch (error) {
      const errno = errnoOf(error);
      if (errno === 'ENOENT') {
        return fsFail('NOT_FOUND', 'The item no longer exists');
      }
      if (errno === 'EACCES' || errno === 'EPERM') {
        return fsFail('PERMISSION_DENIED', 'Cannot delete item: permission denied');
      }
      if (errno === 'ENOTEMPTY') {
        return fsFail('ALREADY_EXISTS', 'Cannot delete folder: it is not empty');
      }
      return mapFsError(error, 'Cannot delete item');
    }

    return fsOk({ path: target });
  }

  // -------------------------------------------------------------------------
  // External change watching
  // -------------------------------------------------------------------------

  /** Reconciles the main-process watch set with the renderer's open files. */
  async syncOpenFiles(paths: string[]): Promise<FsResult<{ watching: number }>> {
    const rootResult = await this.requireRoot();
    if (!rootResult.ok) {
      return rootResult;
    }

    const canonical: string[] = [];
    const seen = new Set<string>();
    for (const candidate of paths) {
      if (canonical.length >= MAX_WATCHED_FILES) {
        break;
      }
      const resolved = await resolveInWorkspace(rootResult.value, candidate, {
        allowRoot: false,
      });
      if (!resolved.ok) {
        return resolved;
      }
      if (!seen.has(resolved.value)) {
        seen.add(resolved.value);
        canonical.push(resolved.value);
      }
    }

    const watching = await this.watcher.sync(canonical);
    return fsOk({ watching });
  }

  /** Stops all watches (workspace closed). */
  clearWatches(): void {
    this.watcher.clear();
  }
}

/** Directories first, then case-insensitive natural order by name. */
function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}
