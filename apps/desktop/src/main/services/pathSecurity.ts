/**
 * Workspace path security (spec §7.2, §19.3).
 *
 * Every filesystem request coming from the renderer is resolved through
 * `resolveInWorkspace` immediately before the operation runs:
 *
 *  1. the input must be a string without NUL bytes,
 *  2. it is resolved to an absolute path (lexical `.`/`..` resolution),
 *  3. the deepest existing ancestor is canonicalised with `realpath`, which
 *     follows symbolic links and therefore exposes traversal attempts,
 *  4. dangling symlinks are resolved from their link text,
 *  5. the canonical result must be the workspace root or live strictly
 *     inside it (never a string-prefix comparison — `path.relative` on the
 *     canonical paths, case-insensitive on Windows),
 *  6. destructive operations may additionally refuse the workspace root.
 *
 * The renderer never sees this module; it only receives `FsResult` values.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FsErrorCode, FsResult } from '../../shared/ipc-types';
import { errnoOf, fsFail, fsOk, mapFsError } from './results';

/** Windows reserved device names (case-insensitive). */
const WINDOWS_RESERVED = new Set<string>([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Characters Windows forbids in file names (rejected everywhere for consistency). */
const FORBIDDEN_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*']);

/**
 * Validates a single file/folder name (not a path): no separators, no
 * traversal segments, no control/forbidden characters, no Windows device
 * names, no leading/trailing whitespace.
 */
export function isValidEntryName(name: unknown): name is string {
  if (typeof name !== 'string') {
    return false;
  }
  const length = name.length;
  if (length < 1 || length > 255) {
    return false;
  }
  if (name === '.' || name === '..') {
    return false;
  }
  if (name !== name.trim()) {
    return false;
  }
  for (let i = 0; i < length; i += 1) {
    const char = name[i] as string;
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) {
      return false;
    }
    if (char === '/' || char === '\\' || char === '\0') {
      return false;
    }
    if (FORBIDDEN_CHARS.has(char)) {
      return false;
    }
  }
  const lower = name.toLowerCase();
  if (lower.endsWith('.') || lower.endsWith(' ')) {
    return false;
  }
  const withoutExtension = lower.split('.')[0] ?? lower;
  if (WINDOWS_RESERVED.has(withoutExtension)) {
    return false;
  }
  return true;
}

/** Canonical-comparison form of a path (case-insensitive on Windows). */
function comparable(p: string): string {
  const normalized = path.normalize(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export type PathRelation = 'root' | 'inside' | 'outside';

/** Classifies a canonical path against the canonical workspace root. */
export function relateToRoot(root: string, target: string): PathRelation {
  const base = comparable(root);
  const candidate = comparable(target);
  if (candidate === base) {
    return 'root';
  }
  const relative = path.relative(base, candidate);
  if (relative === '') {
    return 'root';
  }
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return 'outside';
  }
  if (path.isAbsolute(relative)) {
    return 'outside';
  }
  return 'inside';
}

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

interface CanonicalOk {
  ok: true;
  /** Fully canonical path (symlinks resolved as far as they exist). */
  value: string;
}

type CanonicalResult = CanonicalOk | { ok: false; code: FsErrorCode; message: string };

/** Re-attaches the non-existing tail segments (stored deepest-first). */
function joinTail(base: string, tail: readonly string[]): string {
  return tail.length === 0 ? base : path.join(base, ...[...tail].reverse());
}

/**
 * Resolves `absPath` to a canonical path by realpath-ing the deepest
 * existing ancestor and re-attaching the missing tail. Symbolic links
 * (including dangling ones) are followed so escapes are visible to the
 * containment check performed by the caller.
 */
async function canonicalize(absPath: string): Promise<CanonicalResult> {
  const tail: string[] = [];
  let current = absPath;

  for (;;) {
    try {
      const real = await fs.realpath(current);
      if (tail.length > 0) {
        // We walked UP to `current`, so it is the deepest existing
        // ancestor: it must be a directory for the remaining segments to
        // be meaningful (a file in the middle → INVALID_PATH, consistently
        // on every platform — Windows reports ENOENT here, POSIX ENOTDIR).
        try {
          const stat = await fs.stat(real);
          if (!stat.isDirectory()) {
            return fsFail('INVALID_PATH', 'Path component is not a directory');
          }
        } catch (error) {
          return mapFsError(error, 'Cannot access path');
        }
      }
      return { ok: true, value: joinTail(real, tail) };
    } catch (error) {
      const errno = errnoOf(error);
      if (errno !== 'ENOENT' && errno !== 'ENOTDIR') {
        return mapFsError(error, 'Cannot access path');
      }

      // The path may still exist as a dangling symlink, or be a file we
      // tried to descend into — lstat tells us which.
      let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        stat = await fs.lstat(current);
      } catch {
        stat = null;
      }

      if (stat !== null && stat.isSymbolicLink()) {
        try {
          const linkText = await fs.readlink(current);
          const linkTarget = path.resolve(path.dirname(current), linkText);
          return { ok: true, value: joinTail(linkTarget, tail) };
        } catch (linkError) {
          return mapFsError(linkError, 'Cannot resolve symbolic link');
        }
      }

      if (stat !== null) {
        // realpath failed although the entry exists and is not a symlink:
        // an intermediate component is not a directory.
        return fsFail('INVALID_PATH', 'Path component is not a directory');
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return fsFail('NOT_FOUND', 'File or folder does not exist');
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

// ---------------------------------------------------------------------------
// Public resolution API
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** Allow the path to be the workspace root itself (default: true). */
  allowRoot?: boolean;
  /** Require the resolved path to exist (default: false). */
  mustExist?: boolean;
}

/**
 * Resolves a renderer-supplied path inside the active workspace.
 * Must be called immediately before performing the operation it guards.
 */
export async function resolveInWorkspace(
  root: string,
  input: unknown,
  options: ResolveOptions = {},
): Promise<FsResult<string>> {
  const { allowRoot = true, mustExist = false } = options;

  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    return fsFail('INVALID_PATH', 'Path must be a non-empty string');
  }

  let absolute: string;
  try {
    absolute = path.resolve(input);
    if (!path.isAbsolute(absolute)) {
      // Defence in depth: path.resolve always yields an absolute path here,
      // but never proceed with something else.
      return fsFail('INVALID_PATH', 'Path cannot be resolved');
    }
  } catch {
    return fsFail('INVALID_PATH', 'Path cannot be resolved');
  }

  const walk = await canonicalize(absolute);
  if (!walk.ok) {
    return walk;
  }

  const relation = relateToRoot(root, walk.value);
  if (relation === 'outside') {
    console.error('[security] rejected path outside the workspace');
    return fsFail('OUTSIDE_WORKSPACE', 'Path is outside the active workspace');
  }
  if (relation === 'root' && !allowRoot) {
    return fsFail('ROOT_PROTECTED', 'The workspace root cannot be modified');
  }

  if (mustExist) {
    try {
      await fs.stat(walk.value);
    } catch (error) {
      const errno = errnoOf(error);
      if (errno === 'ENOENT') {
        return fsFail('NOT_FOUND', 'File or folder does not exist');
      }
      if (errno === 'ENOTDIR') {
        return fsFail('INVALID_PATH', 'Path component is not a directory');
      }
      return mapFsError(error, 'Cannot access path');
    }
  }

  return fsOk(walk.value);
}

/**
 * Validates and canonicalises a folder the user wants to open as a
 * workspace (no boundary applies yet — this *becomes* the boundary).
 */
export async function resolveWorkspaceRoot(
  candidate: unknown,
): Promise<FsResult<string>> {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0')) {
    return fsFail('INVALID_PATH', 'Folder path must be a non-empty string');
  }
  try {
    const real = await fs.realpath(path.resolve(candidate));
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) {
      return fsFail('NOT_A_DIRECTORY', 'Selected path is not a folder');
    }
    return fsOk(real);
  } catch (error) {
    const errno = errnoOf(error);
    if (errno === 'ENOENT') {
      return fsFail('NOT_FOUND', 'Folder does not exist');
    }
    return mapFsError(error, 'Cannot open folder');
  }
}
