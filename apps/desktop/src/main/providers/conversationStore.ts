/**
 * The conversations of the chat (spec §10.7).
 *
 * The conversations are stored as plain JSON in the user data directory,
 * the same way the recent workspaces are stored. SQLite is not used
 * here: the data is a handful of small, flat records (a title, a
 * provider, a model and a list of messages), the whole file fits into
 * the memory, and it can be read, checked and written atomically. A
 * database would add a native dependency and a migration system for a
 * few hundred kilobytes of history.
 *
 * The history is bounded (50 conversations, 200 messages each), and a
 * conversation never contains an API key — only the id of the provider
 * and the id of the model.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  type ChatMessage,
  type StoredConversation,
} from '../../shared/ai-types';
import { errnoOf } from '../services/results';

/** The name of the file in the user data directory. */
const CONVERSATIONS_FILE_NAME = 'conversations.json';

/** The maximum length of a title. */
const MAX_TITLE_LENGTH = 120;

export class ConversationStore {
  private cache: StoredConversation[] | null = null;

  /** The path of the file. */
  private get filePath(): string {
    return path.join(app.getPath('userData'), CONVERSATIONS_FILE_NAME);
  }

  /** Every conversation, newest first. */
  async list(): Promise<StoredConversation[]> {
    if (this.cache !== null) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeConversations(JSON.parse(raw));
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        console.error('[ai] could not read the conversations', error);
      }
      this.cache = [];
    }
    return this.cache;
  }

  /**
   * Stores a conversation.
   *
   * The conversation is checked before it is written: a corrupted or
   * hostile file cannot inject anything into the panel.
   */
  async save(conversation: StoredConversation): Promise<StoredConversation> {
    const current = await this.list();
    const sanitized = sanitizeConversation(conversation);
    if (sanitized === null) {
      throw new Error('The conversation is not valid');
    }
    const next = [
      sanitized,
      ...current.filter((entry) => entry.id !== sanitized.id),
    ].slice(0, MAX_CONVERSATIONS);
    await this.write(next);
    return sanitized;
  }

  /** Removes a conversation. */
  async remove(id: string): Promise<void> {
    const current = await this.list();
    await this.write(current.filter((entry) => entry.id !== id));
  }

  /** Writes the conversations to disk. */
  private async write(conversations: StoredConversation[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify({ version: 1, conversations }, null, 2),
        'utf8',
      );
      this.cache = conversations;
    } catch (error) {
      console.error('[ai] could not write the conversations', error);
    }
  }
}

/** Accepts only well-formed conversations. */
function sanitizeConversations(parsed: unknown): StoredConversation[] {
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const list = (parsed as { conversations?: unknown }).conversations;
  if (!Array.isArray(list)) {
    return [];
  }
  const conversations: StoredConversation[] = [];
  for (const entry of list) {
    const sanitized = sanitizeConversation(entry);
    if (sanitized !== null) {
      conversations.push(sanitized);
    }
  }
  return conversations
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
}

/** Accepts only a well-formed conversation (null when it is broken). */
function sanitizeConversation(entry: unknown): StoredConversation | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const record = entry as Partial<StoredConversation>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return null;
  }
  const title =
    typeof record.title === 'string'
      ? record.title.slice(0, MAX_TITLE_LENGTH)
      : 'New conversation';
  const messages = Array.isArray(record.messages)
    ? record.messages
        .filter(
          (message): message is ChatMessage =>
            typeof message === 'object' &&
            message !== null &&
            (message.role === 'system' ||
              message.role === 'user' ||
              message.role === 'assistant') &&
            typeof message.content === 'string',
        )
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
    : [];

  return {
    id: record.id,
    title,
    providerId: typeof record.providerId === 'string' ? record.providerId : '',
    model: typeof record.model === 'string' ? record.model : '',
    workspaceRoot:
      typeof record.workspaceRoot === 'string' ? record.workspaceRoot : null,
    messages,
    createdAt:
      typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt:
      typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
  };
}
