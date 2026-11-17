/**
 * Argument validators for the IPC channels (spec §19.2).
 *
 * Every channel validates its arguments before the handler runs, so a
 * malformed or hostile message can never reach a service. The validators
 * are exported separately so they can be unit tested without Electron.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { AgentPermissionCategory } from '../../shared/agent-types';
import { MAX_AUDIO_BYTES } from '../../shared/voice-types';
import { validateModelName } from '../providers/localModels/modelNames';

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

/**
 * A link that the user clicked in the chat.
 *
 * Only http and https are opened; every other scheme (file, javascript,
 * …) is refused, so the output of a model cannot reach the system.
 */
export function assertExternalUrl(args: unknown[]): asserts args is [url: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a link');
  }
  let url: URL;
  try {
    url = new URL(args[0]);
  } catch {
    throw new Error('Invalid link');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can be opened');
  }
}

/**
 * A conversation of the chat.
 */
export function assertConversation(
  args: unknown[],
): asserts args is [conversation: unknown] {
  if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null) {
    throw new Error('Expected a conversation');
  }
  const record = args[0] as {
    id?: unknown;
    title?: unknown;
    messages?: unknown;
  };
  if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 64) {
    throw new Error('Invalid conversation id');
  }
  if (typeof record.title !== 'string' || record.title.length > 120) {
    throw new Error('Invalid conversation title');
  }
  if (!Array.isArray(record.messages) || record.messages.length > 200) {
    throw new Error('Invalid messages');
  }
  for (const message of record.messages) {
    if (typeof message !== 'object' || message === null) {
      throw new Error('Invalid message');
    }
    const entry = message as { role?: unknown; content?: unknown };
    if (
      entry.role !== 'system' &&
      entry.role !== 'user' &&
      entry.role !== 'assistant'
    ) {
      throw new Error('Invalid message role');
    }
    if (typeof entry.content !== 'string' || entry.content.length > 500000) {
      throw new Error('Invalid message content');
    }
  }
}

/**
 * The id of a conversation.
 */
export function assertConversationId(
  args: unknown[],
): asserts args is [id: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a conversation id');
  }
  if (args[0].length === 0 || args[0].length > 64) {
    throw new Error('Invalid conversation id');
  }
}

/**
 * The changed settings of a provider.
 */
export function assertProviderSettings(
  args: unknown[],
): asserts args is [
  providerId: string,
  settings: {
    baseUrl?: string;
    enabled?: boolean;
    remoteConfirmed?: boolean;
  },
] {
  if (args.length !== 2 || typeof args[0] !== 'string') {
    throw new Error('Expected (providerId, settings)');
  }
  if (args[0].length === 0 || args[0].length > 64 || !/^[a-z0-9-]+$/.test(args[0])) {
    throw new Error('Invalid provider id');
  }
  const settings = args[1];
  if (typeof settings !== 'object' || settings === null) {
    throw new Error('Expected the settings of the provider');
  }
  const record = settings as {
    baseUrl?: unknown;
    enabled?: unknown;
    remoteConfirmed?: unknown;
  };
  if (
    record.baseUrl !== undefined &&
    (typeof record.baseUrl !== 'string' || record.baseUrl.length > 2048)
  ) {
    throw new Error('Invalid address');
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    throw new Error('Invalid state');
  }
  if (
    record.remoteConfirmed !== undefined &&
    typeof record.remoteConfirmed !== 'boolean'
  ) {
    throw new Error('Invalid confirmation');
  }
}

/**
 * The attachments of a request.
 *
 * The attachments are paths inside the workspace; the main process reads
 * the files itself.
 */
export function assertContextAttachments(
  args: unknown[],
): asserts args is [attachments: { path: string; kind: 'selection' | 'file' }[]] {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw new Error('Expected the attachments');
  }
  if (args[0].length > 50) {
    throw new Error('Too many attachments');
  }
  for (const attachment of args[0]) {
    if (typeof attachment !== 'object' || attachment === null) {
      throw new Error('Invalid attachment');
    }
    const record = attachment as { path?: unknown; kind?: unknown };
    if (
      typeof record.path !== 'string' ||
      record.path.length === 0 ||
      record.path.length > 4096
    ) {
      throw new Error('Invalid attachment path');
    }
    if (record.kind !== 'selection' && record.kind !== 'file') {
      throw new Error('Invalid attachment kind');
    }
  }
}

/**
 * The task of an agent run.
 */
export function assertAgentTask(
  args: unknown[],
): asserts args is [
  task: string,
  providerId: string,
  model: string,
  approveCloudContext: boolean,
] {
  if (args.length !== 4) {
    throw new Error('Expected (task, providerId, model, approve)');
  }
  const [task, providerId, model, approved] = args;
  if (typeof task !== 'string' || task.trim().length === 0 || task.length > 8000) {
    throw new Error('Invalid task');
  }
  if (
    typeof providerId !== 'string' ||
    providerId.length === 0 ||
    providerId.length > 64 ||
    !/^[a-z0-9-]+$/.test(providerId)
  ) {
    throw new Error('Invalid provider id');
  }
  if (typeof model !== 'string' || model.length === 0 || model.length > 200) {
    throw new Error('Invalid model');
  }
  if (typeof approved !== 'boolean') {
    throw new Error('Expected the approval of the user');
  }
}

/**
 * The id of an agent run.
 */
export function assertRunId(args: unknown[]): asserts args is [runId: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected a run id');
  }
  if (args[0].length === 0 || args[0].length > 64 || !/^[A-Za-z0-9_-]+$/.test(args[0])) {
    throw new Error('Invalid run id');
  }
}

/**
 * The answer of an approval request.
 */
export function assertApprovalAnswer(
  args: unknown[],
): asserts args is [runId: string, approvalId: string, approved: boolean] {
  if (args.length !== 3) {
    throw new Error('Expected (runId, approvalId, approved)');
  }
  const [runId, approvalId, approved] = args;
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > 64) {
    throw new Error('Invalid run id');
  }
  if (
    typeof approvalId !== 'string' ||
    approvalId.length === 0 ||
    approvalId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(approvalId)
  ) {
    throw new Error('Invalid approval id');
  }
  if (typeof approved !== 'boolean') {
    throw new Error('Expected the answer of the user');
  }
}

/**
 * The id of a change proposal.
 */
export function assertProposalId(
  args: unknown[],
): asserts args is [runId: string, proposalId: string] {
  if (args.length !== 2) {
    throw new Error('Expected (runId, proposalId)');
  }
  const [runId, proposalId] = args;
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > 64) {
    throw new Error('Invalid run id');
  }
  if (
    typeof proposalId !== 'string' ||
    proposalId.length === 0 ||
    proposalId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(proposalId)
  ) {
    throw new Error('Invalid proposal id');
  }
}

/** A list of absolute paths from the renderer (the dirty editor buffers). */
function assertPathList(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected a list of paths');
  }
  if (value.length > 500) {
    throw new Error('Too many paths');
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 4096) {
      throw new Error('Invalid path');
    }
  }
}

/**
 * The request of a revert preview: the run and the dirty buffers.
 */
export function assertRevertPreview(
  args: unknown[],
): asserts args is [runId: string, dirtyPaths: string[]] {
  if (args.length !== 2) {
    throw new Error('Expected (runId, dirtyPaths)');
  }
  const [runId, dirtyPaths] = args;
  if (
    typeof runId !== 'string' ||
    runId.length === 0 ||
    runId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(runId)
  ) {
    throw new Error('Invalid run id');
  }
  assertPathList(dirtyPaths);
}

/**
 * The request of a revert: the run, the confirmed conflicts and the
 * dirty buffers. The confirmed paths are only file names; the content
 * never comes from the renderer.
 */
export function assertRevertRequest(
  args: unknown[],
): asserts args is [
  runId: string,
  confirmedPaths: string[],
  dirtyPaths: string[],
] {
  if (args.length !== 3) {
    throw new Error('Expected (runId, confirmedPaths, dirtyPaths)');
  }
  const [runId, confirmedPaths, dirtyPaths] = args;
  if (
    typeof runId !== 'string' ||
    runId.length === 0 ||
    runId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(runId)
  ) {
    throw new Error('Invalid run id');
  }
  assertPathList(confirmedPaths);
  assertPathList(dirtyPaths);
}

/**
 * A change of one permission category.
 *
 * The category is limited to the three the user may configure; `system`
 * is not one of them and is therefore rejected here as well.
 */
export function assertPermissionUpdate(
  args: unknown[],
): asserts args is [category: AgentPermissionCategory, allowed: boolean] {
  if (args.length !== 2) {
    throw new Error('Expected (category, allowed)');
  }
  const [category, allowed] = args;
  if (
    category !== 'read' &&
    category !== 'workspace' &&
    category !== 'command'
  ) {
    throw new Error('Unknown permission category');
  }
  if (typeof allowed !== 'boolean') {
    throw new Error('Expected the permission state');
  }
}

/**
 * The state of the local-only mode.
 *
 * The switch is the only way to change the rule; the renderer cannot
 * ask for an exception for a single request.
 */
export function assertLocalOnly(
  args: unknown[],
): asserts args is [enabled: boolean] {
  if (args.length !== 1 || typeof args[0] !== 'boolean') {
    throw new Error('Expected the state of the local-only mode');
  }
}

/**
 * The audio of one recording.
 *
 * The array buffer must be 16 bit samples (an even number of bytes), must
 * not be empty and must stay under the limit of the application. A
 * renderer cannot send an arbitrarily large message.
 */
export function assertVoiceAudio(
  args: unknown[],
): asserts args is [sessionId: string, audio: ArrayBuffer] {
  if (args.length !== 2) {
    throw new Error('Expected (sessionId, audio)');
  }
  const [sessionId, audio] = args;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Expected the id of a recording session');
  }
  if (!(audio instanceof ArrayBuffer)) {
    throw new Error('Expected the samples of a recording');
  }
  if (
    audio.byteLength === 0 ||
    audio.byteLength % 2 !== 0 ||
    audio.byteLength > MAX_AUDIO_BYTES
  ) {
    throw new Error('The recording has an invalid size');
  }
}

/**
 * The name of a local model.
 *
 * The renderer only sends a name; the main process builds the request
 * itself. The name is nevertheless validated strictly, so a URL, a
 * path or a shell fragment can never reach Ollama (spec §19.2).
 */
export function assertModelName(args: unknown[]): asserts args is [model: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected the name of a model');
  }
  const problem = validateModelName(args[0]);
  if (problem !== null) {
    throw new Error(problem);
  }
}

/**
 * The request of a download.
 *
 * The confirmation of the user travels with the request: the main
 * process refuses a download that was not confirmed, because it
 * reaches out into the registry of Ollama over the internet.
 */
export function assertModelPull(
  args: unknown[],
): asserts args is [model: string, confirmed: boolean] {
  if (args.length !== 2) {
    throw new Error('Expected (model, confirmed)');
  }
  if (typeof args[1] !== 'boolean') {
    throw new Error('Expected the confirmation of the user');
  }
  assertModelName([args[0]]);
}

/**
 * The id of a download.
 *
 * The id is generated by the main process; the renderer can only stop a
 * download that really exists.
 */
export function assertDownloadId(
  args: unknown[],
): asserts args is [downloadId: string] {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('Expected the id of a download');
  }
  const id = args[0];
  if (id.length === 0 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid download id');
  }
}

/**
 * The defaults of the local models.
 *
 * Only the names of models are accepted, and they are validated like
 * every other model name.
 */
export function assertModelDefaults(
  args: unknown[],
): asserts args is [defaults: { chatModel: string; agentModel: string }] {
  if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null) {
    throw new Error('Expected the defaults of the models');
  }
  const record = args[0] as { chatModel?: unknown; agentModel?: unknown };
  if (
    typeof record.chatModel !== 'string' ||
    typeof record.agentModel !== 'string'
  ) {
    throw new Error('Invalid defaults of the models');
  }
  if (record.chatModel.length > 0) {
    assertModelName([record.chatModel]);
  }
  if (record.agentModel.length > 0) {
    assertModelName([record.agentModel]);
  }
}

/**
 * The answer of the user to the plan.
 *
 * Only descriptions can be edited; the validator refuses anything else,
 * so a hostile renderer cannot change a command or a file of the plan.
 */
export function assertPlanAnswer(
  args: unknown[],
): asserts args is [
  runId: string,
  planId: string,
  decision: 'approve' | 'reject',
  edits: { stepId: string; description: string }[],
] {
  if (args.length !== 4) {
    throw new Error('Expected (runId, planId, decision, edits)');
  }
  const [runId, planId, decision, edits] = args;
  if (
    typeof runId !== 'string' ||
    runId.length === 0 ||
    runId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(runId)
  ) {
    throw new Error('Invalid run id');
  }
  if (
    typeof planId !== 'string' ||
    planId.length === 0 ||
    planId.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(planId)
  ) {
    throw new Error('Invalid plan id');
  }
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error('Invalid plan decision');
  }
  if (!Array.isArray(edits) || edits.length > 20) {
    throw new Error('Invalid plan edits');
  }
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) {
      throw new Error('Invalid plan edit');
    }
    const record = edit as { stepId?: unknown; description?: unknown };
    // An edit is exactly a step id and a description: a command, a file
    // or a permission can never be smuggled into an edit.
    const keys = Object.keys(record);
    if (
      keys.length !== 2 ||
      !keys.includes('stepId') ||
      !keys.includes('description')
    ) {
      throw new Error('Invalid plan edit');
    }
    if (
      typeof record.stepId !== 'string' ||
      record.stepId.length === 0 ||
      record.stepId.length > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(record.stepId)
    ) {
      throw new Error('Invalid step id');
    }
    if (
      typeof record.description !== 'string' ||
      record.description.trim().length === 0 ||
      record.description.length > 500
    ) {
      throw new Error('Invalid step description');
    }
  }
}
