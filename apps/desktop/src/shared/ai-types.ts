/**
 * Normalized types of the AI provider layer (spec §11.2).
 *
 * This file is shared by the main process (the providers), the preload
 * bridge and the renderer (the chat panel). It must never import Node.js or
 * Electron runtime APIs so it stays usable in the sandboxed renderer.
 *
 * Every provider is normalised to these types, so the user interface never
 * has to know which provider produced a chunk of text.
 */

/** The role of a chat message. */
export type ChatRole = 'system' | 'user' | 'assistant';

/**
 * One file that is attached to a message.
 *
 * The attachment describes what will be sent; the content itself is read
 * by the main process at the moment the request is sent.
 */
export interface ChatAttachment {
  /** Absolute path inside the workspace. */
  path: string;
  /** The display name (the file name). */
  name: string;
  /** The size of the file in bytes. */
  sizeBytes: number;
  /** True when the content was shortened to fit the context limit. */
  truncated: boolean;
  /** What the user attached. */
  kind: 'selection' | 'file';
  /** The first line of a selection (1-based). */
  startLine?: number;
  /** The last line of a selection (1-based). */
  endLine?: number;
}

/**
 * A description of an attachment before it is sent.
 *
 * The panel shows it, so the user knows exactly what will be sent.
 */
export interface ContextPreview {
  /** The absolute path inside the workspace. */
  path: string;
  /** The display name. */
  name: string;
  /** The size of the content in bytes. */
  sizeBytes: number;
  /** The approximate number of tokens. */
  tokens: number;
  /** True when the content would be shortened. */
  truncated: boolean;
  /** The reason why the file is not sent (secret, ignored, too large). */
  skipped?: string;
}

/** One message of a conversation. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** The files that were attached to this message. */
  attachments?: ChatAttachment[];
}

/** The options of a chat request. */
export interface ChatOptions {
  /** The model to use (the id of the provider). */
  model: string;
  /** The sampling temperature (0 … 2). */
  temperature?: number;
  /** The maximum number of tokens the answer may use. */
  maxTokens?: number;
}

/** Why the provider stopped generating. */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'cancelled'
  | 'error'
  | 'unknown';

/** The token usage of a request (when the provider reports it). */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * The reason a request failed.
 *
 * The codes are provider neutral; the messages are written for the user
 * and never contain credentials.
 */
export type ProviderErrorCode =
  | 'not-installed'
  | 'not-running'
  | 'unauthorized'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'model-not-found'
  | 'invalid-response'
  | 'cancelled'
  | 'disabled'
  | 'no-context-approval'
  | 'unknown';

/** A user-facing description of a failed request. */
export interface ProviderErrorInfo {
  code: ProviderErrorCode;
  /** The message shown to the user. It never contains a key. */
  message: string;
  /** How long the provider asked the client to wait (rate limits). */
  retryAfterMs?: number;
}

/** The structured result of a provider operation. */
export type AiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderErrorInfo };

/** One normalized event of a streaming answer. */
export type AIStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'text'; delta: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'error'; error: ProviderErrorInfo };

/**
 * What a provider can actually do.
 *
 * A provider must never pretend to support a capability it does not
 * implement (spec §11.1).
 */
export interface ProviderCapabilities {
  /** The answer can be streamed. */
  streaming: boolean;
  /** The provider can return tool calls (Milestone 5 — not used yet). */
  toolCalls: boolean;
  /** The provider can read images. */
  vision: boolean;
  /** The provider can return structured output. */
  structuredOutput: boolean;
  /** The provider accepts a system prompt. */
  systemPrompt: boolean;
  /** The provider runs on the user's machine (nothing leaves the computer). */
  local: boolean;
}

/** The result of a connection check. */
export interface ProviderStatus {
  /** True when the provider answered. */
  available: boolean;
  /** The reason when it is not available. */
  reason?: ProviderErrorCode;
  /** A user-facing explanation. */
  message?: string;
  /** How long the check took (milliseconds). */
  latencyMs?: number;
}

/** One model of a provider. */
export interface ProviderModel {
  /** The id that is sent to the provider. */
  id: string;
  /** The display name. */
  name: string;
  /** The size of the model on disk (Ollama) — used for the memory note. */
  sizeBytes?: number;
  /** The model family (for example "llama"). */
  family?: string;
  /** The parameter size (for example "7B"). */
  parameterSize?: string;
  /** True when the provider knows that the model supports tool calls. */
  supportsToolCalls?: boolean;
}

/**
 * A provider as the renderer sees it.
 *
 * It never contains a key — the renderer only learns whether a key is
 * configured (spec §19.5).
 */
export interface ProviderDescriptor {
  /** The id of the provider ("ollama", "openai-compatible", …). */
  id: string;
  /** The display name. */
  name: string;
  /** 'local' providers never send anything off the machine. */
  kind: 'local' | 'cloud';
  /** False when the user switched the provider off. */
  enabled: boolean;
  /** The base URL of the provider (not a secret). */
  baseUrl: string;
  /** True when an API key is stored for this provider. */
  hasKey: boolean;
  /** True when the user confirmed a base URL outside the local machine. */
  remoteConfirmed: boolean;
}

/** A conversation that is stored on disk. */
export interface StoredConversation {
  id: string;
  title: string;
  /** The id of the provider the conversation uses. */
  providerId: string;
  /** The id of the model the conversation uses. */
  model: string;
  /** The workspace the conversation belongs to (null = no workspace). */
  workspaceRoot: string | null;
  /** The messages of the conversation. */
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** The maximum number of conversations that are kept on disk. */
export const MAX_CONVERSATIONS = 50;
/** The maximum number of messages of one conversation. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;
/** The maximum length of a conversation title. */
export const MAX_CONVERSATION_TITLE_LENGTH = 120;
