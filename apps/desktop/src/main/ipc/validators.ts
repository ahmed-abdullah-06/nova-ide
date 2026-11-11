/**
 * Argument validators for the IPC channels (spec §19.2).
 *
 * Every channel validates its arguments before the handler runs, so a
 * malformed or hostile message can never reach a service. The validators
 * are exported separately so they can be unit tested without Electron.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';

/** Validates the argument list of a channel; throws on unexpected input. */
export type ArgsValidator<C extends keyof IpcInvokeMap> = (
  args: unknown[],
) => asserts args is IpcInvokeMap[C]['args'];

export function assertNoArgs(args: unknown[]): asserts args is [] {
  if (args.length !== 0) {
    throw new Error('This channel does not accept arguments');
  }
}

export function assertOneString(args: unknown[]): asserts args is [string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a single string argument');
  }
}

export function assertTwoStrings(args: unknown[]): asserts args is [string, string] {
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'string'
  ) {
    throw new Error('Expected two string arguments');
  }
}

export function assertOptionalString(args: unknown[]): asserts args is [string?] {
  if (args.length > 1) {
    throw new Error('Expected at most one optional string argument');
  }
  if (args.length === 1 && args[0] !== undefined && typeof args[0] !== 'string') {
    throw new Error('Expected a string argument');
  }
}

export function assertWriteFileArgs(
  args: unknown[],
): asserts args is [string, string, number | null] {
  if (args.length !== 3 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
    throw new Error('Expected (path, content, expectedMtimeMs)');
  }
  const expected = args[2];
  if (expected !== null && typeof expected !== 'number') {
    throw new Error('expectedMtimeMs must be a number or null');
  }
}

export function assertSaveAsArgs(
  args: unknown[],
): asserts args is [string | null, string] {
  if (args.length !== 2 || typeof args[1] !== 'string') {
    throw new Error('Expected (suggestedPath, content)');
  }
  const suggested = args[0];
  if (suggested !== null && typeof suggested !== 'string') {
    throw new Error('suggestedPath must be a string or null');
  }
}

export function assertStringArray(args: unknown[]): asserts args is [string[]] {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw new Error('Expected a single array argument');
  }
  if (!args[0].every((item) => typeof item === 'string')) {
    throw new Error('Expected an array of strings');
  }
}

/** `terminal:create` — optional working directory. */
export function assertOptionalCwd(args: unknown[]): asserts args is [string?] {
  assertOptionalString(args);
}

/** `terminal:write` — (sessionId, data). */
export function assertSessionAndData(
  args: unknown[],
): asserts args is [string, string] {
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'string'
  ) {
    throw new Error('Expected (sessionId, data)');
  }
}

/** `terminal:resize` — (sessionId, cols, rows). */
export function assertSessionAndSize(
  args: unknown[],
): asserts args is [string, number, number] {
  if (
    args.length !== 3 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'number' ||
    typeof args[2] !== 'number'
  ) {
    throw new Error('Expected (sessionId, cols, rows)');
  }
}

/** `search:query` — (requestId, mode, pattern). */
export function assertSearchQuery(
  args: unknown[],
): asserts args is [string, string, string] {
  if (
    args.length !== 3 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'string' ||
    typeof args[2] !== 'string'
  ) {
    throw new Error('Expected (requestId, mode, pattern)');
  }
  if (args[1] !== 'files' && args[1] !== 'content') {
    throw new Error('Unknown search mode');
  }
}

/** `git:diff` — (path, staged). */
export function assertPathAndBoolean(
  args: unknown[],
): asserts args is [string, boolean] {
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'boolean'
  ) {
    throw new Error('Expected (path, staged)');
  }
}
