/**
 * The state of the chat (spec §6.1, §9.1, §21).
 *
 * The renderer never talks to a provider itself: it asks the main
 * process, which streams the answer through the push channel.
 *
 * The streamed text is collected in a buffer and written into the React
 * state at most every 100 ms — a model that sends a chunk every
 * millisecond must not make the panel re-render a thousand times a
 * second.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AIStreamEvent,
  ChatMessage,
  ProviderDescriptor,
  ProviderModel,
  ProviderStatus,
} from '../../../shared/ai-types';

/** How often the streamed text is written into the state (milliseconds). */
export const STREAM_FLUSH_MS = 100;

/** A file the user attached to a message. */
export interface Attachment {
  /** The absolute path inside the workspace. */
  path: string;
  /** The display name. */
  name: string;
  /** The size of the file in bytes. */
  sizeBytes: number;
  /** What the user attached. */
  kind: 'selection' | 'file';
}

export interface AiController {
  /** The providers the user can choose from. */
  providers: ProviderDescriptor[];
  /** The models of the selected provider. */
  models: ProviderModel[];
  /** The connection state of the selected provider. */
  status: ProviderStatus | null;
  /** The id of the selected provider. */
  providerId: string | null;
  /** The id of the selected model. */
  model: string;
  /** The messages of the conversation. */
  messages: ChatMessage[];
  /** The files that are attached to the next message. */
  attachments: Attachment[];
  /** True while an answer is coming in. */
  streaming: boolean;
  /** The last error. */
  error: string | null;
  /** Selects a provider (and its first model). */
  selectProvider: (providerId: string) => void;
  /** Selects a model. */
  selectModel: (model: string) => void;
  /** Sends a message. */
  send: (text: string, approveCloudContext: boolean) => Promise<void>;
  /** Stops the running request. */
  stop: () => void;
  /** Asks the last question again. */
  regenerate: () => Promise<void>;
  /** Attaches a file to the next message. */
  attach: (attachment: Attachment) => void;
  /** Removes an attached file. */
  detach: (path: string) => void;
  /** Re-reads the providers and the models. */
  refresh: () => void;
  /** Sets the messages of the conversation (when a conversation is loaded). */
  setMessages: (messages: ChatMessage[]) => void;
}

export function useAi(): AiController {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The request that is currently running. */
  const requestRef = useRef<string | null>(null);
  /** The text that was received but not yet written into the state. */
  const pendingRef = useRef<string>('');
  /** The timer that writes the pending text into the state. */
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The counter that makes the request ids unique. */
  const counterRef = useRef(0);
  /**
   * Increases when the providers were refreshed.
   *
   * The models of a provider are read again when its settings changed
   * (a new address can offer other models).
   */
  const [providersVersion, setProvidersVersion] = useState(0);

  /** Writes the pending text into the state. */
  const flush = useCallback((): void => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending.length === 0) {
      return;
    }
    pendingRef.current = '';
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last === undefined || last.role !== 'assistant') {
        return current;
      }
      const next = [...current];
      next[next.length - 1] = { ...last, content: last.content + pending };
      return next;
    });
  }, []);

  /** Handles one event of a running request. */
  const handleEvent = useCallback(
    (requestId: string, event: AIStreamEvent): void => {
      if (requestRef.current !== requestId) {
        return;
      }
      switch (event.type) {
        case 'text':
          pendingRef.current += event.delta;
          if (flushTimerRef.current === null) {
            flushTimerRef.current = setTimeout(() => {
              flushTimerRef.current = null;
              flush();
            }, STREAM_FLUSH_MS);
          }
          break;
        case 'finish':
          flush();
          setStreaming(false);
          requestRef.current = null;
          break;
        case 'error':
          flush();
          setStreaming(false);
          setError(event.error.message);
          requestRef.current = null;
          break;
        default:
          break;
      }
    },
    [flush],
  );

  // The stream of the main process.
  useEffect(() => {
    const api = window.nova;
    if (!api) {
      return;
    }
    return api.ai.onStream((payload) => {
      handleEvent(payload.requestId, payload.event);
    });
  }, [handleEvent]);

  // The providers and the models.
  const refresh = useCallback((): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.ai.providers().then((result) => {
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setProviders(result.value);
      setProvidersVersion((version) => version + 1);
      setProviderId((current) => {
        if (current !== null && result.value.some((p) => p.id === current)) {
          return current;
        }
        const first = result.value.find((provider) => provider.enabled);
        return first?.id ?? result.value[0]?.id ?? null;
      });
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The models of the selected provider.
  useEffect(() => {
    const api = window.nova;
    if (!api || providerId === null) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void api.ai.models(providerId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setModels(result.value);
        setModel((current) =>
          result.value.some((entry) => entry.id === current)
            ? current
            : (result.value[0]?.id ?? ''),
        );
      } else {
        setModels([]);
        setModel('');
        setError(result.error.message);
      }
    });
    void api.ai.status(providerId).then((result) => {
      if (!cancelled && result.ok) {
        setStatus(result.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, providersVersion]);

  const selectProvider = useCallback((next: string): void => {
    setProviderId(next);
    setModel('');
    setStatus(null);
  }, []);

  /**
   * Sends a request.
   *
   * @param history The messages of the conversation (without the new one).
   * @param userText The question of the user.
   * @param files The files that are attached to the question.
   * @param approveCloudContext True when the user approved the context
   *   for a cloud provider.
   * @param appendUser False when the question is already part of the
   *   history (the "ask again" case).
   */
  const runRequest = useCallback(
    async (
      history: ChatMessage[],
      userText: string,
      files: Attachment[],
      approveCloudContext: boolean,
      appendUser: boolean,
    ): Promise<void> => {
      const api = window.nova;
      if (!api || providerId === null || model.length === 0) {
        setError('Choose a provider and a model first.');
        return;
      }
      const trimmed = userText.trim();
      if (trimmed.length === 0) {
        return;
      }

      const withUser: ChatMessage[] = appendUser
        ? [
            ...history,
            {
              role: 'user',
              content: trimmed,
              attachments:
                files.length > 0
                  ? files.map((attachment) => ({
                      path: attachment.path,
                      name: attachment.name,
                      sizeBytes: attachment.sizeBytes,
                      truncated: false,
                      kind: attachment.kind,
                    }))
                  : undefined,
            },
          ]
        : history;

      setMessages([...withUser, { role: 'assistant', content: '' }]);
      setAttachments([]);
      setError(null);
      setStreaming(true);
      pendingRef.current = '';

      counterRef.current += 1;
      const requestId = `chat-${counterRef.current}`;
      requestRef.current = requestId;

      const result = await api.ai.chat(
        requestId,
        providerId,
        model,
        withUser,
        files.map((attachment) => ({
          path: attachment.path,
          kind: attachment.kind,
        })),
        approveCloudContext,
      );
      if (!result.ok) {
        setStreaming(false);
        requestRef.current = null;
        setError(result.error.message);
        // The empty answer of the assistant is removed again.
        setMessages(withUser);
      }
    },
    [model, providerId],
  );

  const send = useCallback(
    async (text: string, approveCloudContext: boolean): Promise<void> => {
      await runRequest(messages, text, attachments, approveCloudContext, true);
    },
    [attachments, messages, runRequest],
  );

  const stop = useCallback((): void => {
    const requestId = requestRef.current;
    if (requestId === null) {
      return;
    }
    void window.nova?.ai.cancel(requestId);
    flush();
    setStreaming(false);
    requestRef.current = null;
  }, [flush]);

  const regenerate = useCallback(async (): Promise<void> => {
    // The answer of the assistant is dropped and the question is asked
    // again.
    const history = [...messages];
    if (
      history.length > 0 &&
      history[history.length - 1]?.role === 'assistant'
    ) {
      history.pop();
    }
    const last = history[history.length - 1];
    if (last === undefined || last.role !== 'user') {
      return;
    }
    await runRequest(history, last.content, [], false, false);
  }, [messages, runRequest]);

  const attach = useCallback((attachment: Attachment): void => {
    setAttachments((current) => [
      ...current.filter((entry) => entry.path !== attachment.path),
      attachment,
    ]);
  }, []);

  const detach = useCallback((path: string): void => {
    setAttachments((current) => current.filter((entry) => entry.path !== path));
  }, []);

  const setConversationMessages = useCallback((next: ChatMessage[]): void => {
    setMessages(next);
    pendingRef.current = '';
  }, []);

  return {
    providers,
    models,
    status,
    providerId,
    model,
    messages,
    attachments,
    streaming,
    error,
    selectProvider,
    selectModel: setModel,
    send,
    stop,
    regenerate,
    attach,
    detach,
    refresh,
    setMessages: setConversationMessages,
  };
}
