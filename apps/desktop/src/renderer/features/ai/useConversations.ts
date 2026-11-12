/**
 * The conversations of the chat (spec §10.7).
 *
 * The conversations are stored by the main process (plain JSON in the
 * user data directory); the renderer only sees the list and the current
 * conversation.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, StoredConversation } from '../../../shared/ai-types';

export interface ConversationController {
  /** Every conversation, newest first. */
  conversations: StoredConversation[];
  /** The conversation that is open (null when there is none). */
  current: StoredConversation | null;
  /** Creates a conversation and opens it. */
  create: () => StoredConversation;
  /** Opens a conversation. */
  open: (id: string) => void;
  /** Renames a conversation. */
  rename: (id: string, title: string) => void;
  /** Removes a conversation. */
  remove: (id: string) => void;
  /** Stores the messages of the open conversation. */
  save: (messages: ChatMessage[]) => void;
  /**
   * Stores the provider and the model of the open conversation.
   *
   * Every conversation keeps its own provider and model, so switching
   * between conversations restores them.
   */
  setProvider: (providerId: string, model: string) => void;
}

/** Creates the id of a conversation. */
function newId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The title of a conversation is derived from its first question. */
export function deriveTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.role === 'user');
  if (first === undefined) {
    return 'New conversation';
  }
  const text = first.content.trim().replace(/\s+/g, ' ');
  if (text.length === 0) {
    return 'New conversation';
  }
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function useConversations(): ConversationController {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const reload = useCallback((): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.ai.conversations().then((list) => {
      setConversations(list);
      setCurrentId((id) => id ?? list[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback((): StoredConversation => {
    const conversation: StoredConversation = {
      id: newId(),
      title: 'New conversation',
      providerId: '',
      model: '',
      workspaceRoot: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((current) => [conversation, ...current]);
    setCurrentId(conversation.id);
    return conversation;
  }, []);

  const open = useCallback((id: string): void => {
    setCurrentId(id);
  }, []);

  const rename = useCallback((id: string, title: string): void => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, title: title.slice(0, 120), updatedAt: Date.now() }
          : conversation,
      ),
    );
  }, []);

  const remove = useCallback(
    (id: string): void => {
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== id),
      );
      setCurrentId((current) => (current === id ? null : current));
      void window.nova?.ai.deleteConversation(id);
    },
    [],
  );

  const save = useCallback(
    (messages: ChatMessage[]): void => {
      setConversations((current) => {
        const id = currentId;
        if (id === null) {
          return current;
        }
        const now = Date.now();
        let updated = current.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                messages,
                title:
                  conversation.title === 'New conversation'
                    ? deriveTitle(messages)
                    : conversation.title,
                updatedAt: now,
              }
            : conversation,
        );
        const conversation = updated.find((entry) => entry.id === id);
        if (conversation !== undefined) {
          void window.nova?.ai.saveConversation(conversation);
        }
        return updated;
      });
    },
    [currentId],
  );

  const setProvider = useCallback(
    (providerId: string, model: string): void => {
      setConversations((current) => {
        const id = currentId;
        if (id === null) {
          return current;
        }
        const next = current.map((conversation) =>
          conversation.id === id
            ? { ...conversation, providerId, model, updatedAt: Date.now() }
            : conversation,
        );
        const conversation = next.find((entry) => entry.id === id);
        if (conversation !== undefined) {
          void window.nova?.ai.saveConversation(conversation);
        }
        return next;
      });
    },
    [currentId],
  );

  const current =
    conversations.find((conversation) => conversation.id === currentId) ?? null;

  return {
    conversations,
    current,
    create,
    open,
    rename,
    remove,
    save,
    setProvider,
  };
}
