/**
 * The context manager of the agent (spec §10.2, §21).
 *
 * A run grows with every step: each tool result is appended to the
 * conversation that is sent back to the model. Without a bound, a long
 * run would exceed the window of the model (and the memory of a machine
 * without a dedicated GPU) — or it would be silently cut by the provider.
 *
 * This module keeps a request within a budget that is chosen for the
 * provider and the model:
 *
 *  - the system rules (the first message) and the task (the second
 *    message) are NEVER shortened or dropped,
 *  - old tool results are shortened, the oldest ones first,
 *  - when the history still does not fit, the oldest entries are omitted,
 *  - every change is reported in a visible notice that is part of the
 *    request, so the model (and the user, through the timeline) knows
 *    that the history was bounded.
 *
 * The manager is pure: it never calls a provider or a tool.
 */
import type { ChatMessage } from '../../shared/ai-types';

/** How much of the conversation may be sent with one request. */
export interface ContextBudget {
  /** The maximum number of characters of the whole prompt. */
  maxTotalCharacters: number;
  /** The maximum length of a recent tool result. */
  maxRecentMessageCharacters: number;
  /** The maximum length of an older tool result. */
  maxOldMessageCharacters: number;
  /** The number of messages that are kept at their full (bounded) length. */
  keepRecentMessages: number;
}

/** The default budget (a conservative size for 8k-token models). */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTotalCharacters: 48_000,
  maxRecentMessageCharacters: 12_000,
  maxOldMessageCharacters: 2_000,
  keepRecentMessages: 4,
};

/** The local budget: a small model on a machine without a dedicated GPU. */
export const LOCAL_CONTEXT_BUDGET: ContextBudget = {
  ...DEFAULT_CONTEXT_BUDGET,
  maxTotalCharacters: 24_000,
};

/**
 * The budget of a provider and a model.
 *
 * The sizes are deliberately conservative: the answer of the model has
 * to fit into the same window, and a local model is slower with every
 * token. A product could read the real window of a model; this version
 * uses a documented, provider-neutral value instead of guessing a
 * number per model name.
 *
 * @param kind 'local' or 'cloud'.
 * @param _model The id of the model (reserved for a per-model table).
 */
export function contextBudgetFor(
  kind: 'local' | 'cloud',
  _model: string,
): ContextBudget {
  return kind === 'local' ? LOCAL_CONTEXT_BUDGET : DEFAULT_CONTEXT_BUDGET;
}

/** The result of bounding a conversation. */
export interface CompactedContext {
  /** The messages that may be sent. */
  messages: ChatMessage[];
  /** The visible notice (null when nothing had to be changed). */
  notice: string | null;
  /** The number of messages that were shortened. */
  shortened: number;
  /** The number of messages that were omitted. */
  omitted: number;
}

/** The last messages of the history that belong to the system/task pair. */
const PROTECTED_MESSAGES = 2;

/**
 * Bounds the conversation that is sent to the model.
 *
 * @param messages The full conversation (system, task, history).
 * @param budget The budget of the request.
 * @returns The bounded messages and a visible notice.
 */
export function compactContext(
  messages: readonly ChatMessage[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): CompactedContext {
  if (messages.length <= PROTECTED_MESSAGES) {
    return { messages: [...messages], notice: null, shortened: 0, omitted: 0 };
  }

  const system = messages[0];
  const task = messages[1];
  if (system === undefined || task === undefined) {
    return { messages: [...messages], notice: null, shortened: 0, omitted: 0 };
  }

  // The rules and the task are untouchable. If they alone exceed the
  // budget, the request is still sent: a truncated safety rule would be
  // worse than a long prompt.
  const protectedLength = system.content.length + task.content.length;
  const history = messages.slice(PROTECTED_MESSAGES);
  const recentFrom = Math.max(0, history.length - budget.keepRecentMessages);

  const shortenedHistory: ChatMessage[] = [];
  let shortened = 0;
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message === undefined) {
      continue;
    }
    const isRecent = index >= recentFrom;
    const limit = isRecent
      ? budget.maxRecentMessageCharacters
      : budget.maxOldMessageCharacters;
    if (message.content.length <= limit) {
      shortenedHistory.push(message);
      continue;
    }
    shortened += 1;
    shortenedHistory.push({
      ...message,
      content:
        `${message.content.slice(0, limit)}\n` +
        `[shortened by the context manager: ${message.content.length - limit} characters were removed]`,
    });
  }

  // Reserve room for the notice itself; it is added below.
  const noticeTemplate = (shortenedCount: number, omittedCount: number): string =>
    '[Context notice] ' +
    `${shortenedCount} older tool result${shortenedCount === 1 ? ' was' : 's were'} shortened` +
    (omittedCount > 0
      ? ` and ${omittedCount} ${omittedCount === 1 ? 'was' : 'were'} omitted`
      : '') +
    ' to keep this request within the context limit. ' +
    'The safety rules at the start of the conversation and the task are unchanged.';

  const available =
    budget.maxTotalCharacters - protectedLength - 200;

  // Drop the oldest messages until the history fits (the notice is
  // counted as well). The newest messages are always kept first.
  let kept = shortenedHistory;
  let omitted = 0;
  const lengthOf = (entries: ChatMessage[]): number =>
    entries.reduce((total, entry) => total + entry.content.length, 0);
  while (
    kept.length > 0 &&
    lengthOf(kept) > available
  ) {
    kept = kept.slice(1);
    omitted += 1;
  }

  const notice =
    shortened > 0 || omitted > 0
      ? noticeTemplate(shortened, omitted)
      : null;

  const bounded: ChatMessage[] = [system, task];
  if (notice !== null) {
    bounded.push({ role: 'user', content: notice });
  }
  bounded.push(...kept);

  return { messages: bounded, notice, shortened, omitted };
}
