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

/**
 * A provider id.
 *
 * The id is used to look up the provider in the registry, so it is
 * limited to a short, safe charset.
 */
export function assertProviderId(
  args: unknown[],
): asserts args is [providerId: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a provider id');
  }
  const id = args[0];
  if (id.length === 0 || id.length > 64 || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error('Invalid provider id');
  }
}

/**
 * A request id of the renderer.
 *
 * The id is used to correlate the streamed events, so it is limited to a
 * short, safe charset.
 */
export function assertRequestId(
  args: unknown[],
): asserts args is [requestId: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a request id');
  }
  const id = args[0];
  if (id.length === 0 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid request id');
  }
}

/**
 * The chat request of the renderer.
 *
 * The messages are plain text; the attachments are paths inside the
 * workspace (the main process reads the files itself).
 */
export function assertChatRequest(
  args: unknown[],
): asserts args is [
  requestId: string,
  providerId: string,
  model: string,
  messages: unknown[],
  attachments: unknown[],
  approveCloudContext: boolean,
] {
  if (args.length !== 6) {
    throw new Error('Expected (requestId, providerId, model, messages, attachments, approve)');
  }
  const [requestId, providerId, model, messages, attachments, approved] = args;
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) {
    throw new Error('Invalid request id');
  }
  if (typeof providerId !== 'string' || providerId.length === 0 || providerId.length > 64) {
    throw new Error('Invalid provider id');
  }
  if (typeof model !== 'string' || model.length === 0 || model.length > 200) {
    throw new Error('Invalid model');
  }
  if (!Array.isArray(messages) || messages.length > 200) {
    throw new Error('Invalid messages');
  }
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      throw new Error('Invalid message');
    }
    const record = message as { role?: unknown; content?: unknown };
    if (
      record.role !== 'system' &&
      record.role !== 'user' &&
      record.role !== 'assistant'
    ) {
      throw new Error('Invalid message role');
    }
    if (typeof record.content !== 'string' || record.content.length > 200000) {
      throw new Error('Invalid message content');
    }
  }
  if (!Array.isArray(attachments) || attachments.length > 50) {
    throw new Error('Invalid attachments');
  }
  for (const attachment of attachments) {
    if (typeof attachment !== 'object' || attachment === null) {
      throw new Error('Invalid attachment');
    }
    const record = attachment as { path?: unknown; kind?: unknown };
    if (typeof record.path !== 'string' || record.path.length === 0 || record.path.length > 4096) {
      throw new Error('Invalid attachment path');
    }
    if (record.kind !== 'selection' && record.kind !== 'file') {
      throw new Error('Invalid attachment kind');
    }
  }
  if (typeof approved !== 'boolean') {
    throw new Error('Expected the approval of the context');
  }
}

/**
 * The API key of a provider.
 *
 * The key travels from the renderer to the main process exactly once
 * (the user typed it); the main process encrypts it and never returns
 * it.
 */
export function assertProviderKey(
  args: unknown[],
): asserts args is [providerId: string, key: string] {
  if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
    throw new Error('Expected (providerId, key)');
  }
  if (args[0].length === 0 || args[0].length > 64 || !/^[a-z0-9-]+$/.test(args[0])) {
    throw new Error('Invalid provider id');
  }
  if (args[1].length === 0 || args[1].length > 4096) {
    throw new Error('Invalid API key');
  }
}
