/**
 * Structured filesystem results and error mapping (spec §10, §19.2, §19.3).
 *
 * Services never throw across the IPC boundary: every operation returns an
 * `FsResult<T>` so the renderer can display a precise, user-friendly message
 * while technical details are logged safely (no file contents, no stacks).
 */
import type { FsErrorCode, FsResult } from '../../shared/ipc-types';

export function fsOk<T>(value: T): FsResult<T> {
  return { ok: true, value };
}

/** The failure branch of `FsResult` (assignable to any `FsResult<T>`). */
export interface FsFailure {
  ok: false;
  code: FsErrorCode;
  message: string;
}

export function fsFail<T>(code: FsErrorCode, message: string): FsResult<T> {
  return { ok: false, code, message };
}

/** Extracts the POSIX errno string from an unknown error, if present. */
export function errnoOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

/** errno → structured error code + safe human-readable detail. */
const ERRNO_TABLE: Readonly<Record<string, { code: FsErrorCode; detail: string }>> = {
  ENOENT: { code: 'NOT_FOUND', detail: 'file or folder not found' },
  EEXIST: { code: 'ALREADY_EXISTS', detail: 'name already exists' },
  ENOTEMPTY: { code: 'ALREADY_EXISTS', detail: 'folder is not empty' },
  EACCES: { code: 'PERMISSION_DENIED', detail: 'permission denied' },
  EPERM: { code: 'PERMISSION_DENIED', detail: 'operation not permitted' },
  EROFS: { code: 'PERMISSION_DENIED', detail: 'read-only location' },
  EISDIR: { code: 'IS_DIRECTORY', detail: 'path is a folder' },
  ENOTDIR: { code: 'NOT_A_DIRECTORY', detail: 'path component is not a folder' },
  ELOOP: { code: 'INVALID_PATH', detail: 'too many symbolic links' },
  ENAMETOOLONG: { code: 'INVALID_PATH', detail: 'name is too long' },
  EINVAL: { code: 'INVALID_PATH', detail: 'invalid path' },
  EBADF: { code: 'INVALID_PATH', detail: 'invalid path' },
  ENOSPC: { code: 'UNKNOWN', detail: 'disk is full' },
  EMFILE: { code: 'UNKNOWN', detail: 'too many open files' },
};

/**
 * Converts an unexpected filesystem error into a structured failure.
 * `context` is a short action label (e.g. `Cannot delete folder`).
 */
export function mapFsError(error: unknown, context: string): FsFailure {
  const errno = errnoOf(error);
  const entry = errno !== undefined ? ERRNO_TABLE[errno] : undefined;
  const detail = entry?.detail ?? 'unexpected filesystem error';
  const message = `${context}: ${detail}`;

  // Log only the action and errno — never file contents (spec §25).
  console.error(`[fs] ${context} (${errno ?? 'unknown'})`);

  if (entry) {
    return { ok: false, code: entry.code, message };
  }
  return { ok: false, code: 'UNKNOWN', message };
}
