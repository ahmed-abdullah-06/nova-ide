/**
 * Terminal session management for the renderer (spec §6.1, §17).
 *
 * The renderer only ever sees the narrow `NovaTerminalApi`: it creates a
 * session, writes keystrokes, resizes and kills it. It never receives a
 * process handle, a command line or any Node.js API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalSession } from '../../../shared/ipc-types';

export interface TerminalSessionState {
  /** The session as reported by the main process. */
  session: TerminalSession;
  /** True once the shell has exited. */
  exited: boolean;
  /** Exit code of the shell, when it exited normally. */
  exitCode: number | null;
}

/** A piece of terminal output that arrived for a session. */
export interface TerminalOutputChunk {
  sessionId: string;
  data: string;
}

/**
 * A subscriber of a session's output.
 *
 * The cursor is the position of the subscriber in the output buffer: a
 * subscriber that attaches late still receives the output it missed.
 */
interface OutputSubscription {
  listener: (chunk: string) => void;
  cursor: number;
}

export interface TerminalController {
  /** All sessions, oldest first. */
  sessions: TerminalSessionState[];
  /** The session whose output is currently shown. */
  activeSessionId: string | null;
  /** Creates a new session and returns its id, or null on failure. */
  createSession: () => Promise<string | null>;
  /** Closes a session (kills the shell). */
  closeSession: (sessionId: string) => void;
  /** Selects the session whose output is shown. */
  selectSession: (sessionId: string) => void;
  /** Sends keystrokes to a session. */
  write: (sessionId: string, data: string) => void;
  /** Interrupts the command that is running in a session. */
  stop: (sessionId: string) => void;
  /** Resizes a session's pseudo-terminal. */
  resize: (sessionId: string, cols: number, rows: number) => void;
  /** Subscribes to output of a session; returns an unsubscribe function. */
  subscribeOutput: (
    sessionId: string,
    listener: (chunk: string) => void,
  ) => () => void;
}

/**
 * Manages the terminal sessions of the panel.
 *
 * @param enabled True when a workspace is open — a terminal always starts
 *   inside the workspace, so no session can exist before that.
 */
export function useTerminalSessions(enabled: boolean): TerminalController {
  const [sessions, setSessions] = useState<TerminalSessionState[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  /** Output buffers, kept outside React state (they change very often). */
  const buffers = useRef(new Map<string, string[]>());
  const listeners = useRef(new Map<string, Set<OutputSubscription>>());

  // Subscribe to the main process once and fan the output out.
  useEffect(() => {
    const api = window.nova;
    if (!api) {
      return;
    }
    const unsubscribeData = api.terminal.onData((event) => {
      const buffer = buffers.current.get(event.sessionId);
      if (buffer === undefined) {
        return;
      }
      buffer.push(event.data);
      // Keep the buffer bounded so a chatty command cannot exhaust memory.
      const MAX_BUFFERED_CHUNKS = 2000;
      if (buffer.length > MAX_BUFFERED_CHUNKS) {
        buffer.splice(0, buffer.length - MAX_BUFFERED_CHUNKS);
      }
      for (const subscription of listeners.current.get(event.sessionId) ?? []) {
        // The cursor points behind the chunk that was just appended.
        subscription.cursor = buffer.length;
        subscription.listener(event.data);
      }
    });

    const unsubscribeExit = api.terminal.onExit((event) => {
      setSessions((current) =>
        current.map((entry) =>
          entry.session.id === event.sessionId
            ? { ...entry, exited: true, exitCode: event.exitCode }
            : entry,
        ),
      );
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, []);

  const createSession = useCallback(async (): Promise<string | null> => {
    const api = window.nova;
    if (!api) {
      return null;
    }
    const result = await api.terminal.create();
    if (!result.ok) {
      return null;
    }
    buffers.current.set(result.value.id, []);
    setSessions((current) => [
      ...current,
      { session: result.value, exited: false, exitCode: null },
    ]);
    setActiveSessionId(result.value.id);
    return result.value.id;
  }, []);

  // A session is started automatically as soon as a workspace is open —
  // a terminal always lives inside the workspace, so it cannot be created
  // before that.
  useEffect(() => {
    if (!enabled || sessions.length > 0) {
      return;
    }
    let cancelled = false;
    void createSession().then(() => {
      if (cancelled) {
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, sessions.length, createSession]);

  const closeSession = useCallback((sessionId: string): void => {
    const api = window.nova;
    void api?.terminal.kill(sessionId);
    buffers.current.delete(sessionId);
    listeners.current.delete(sessionId);
    setSessions((current) =>
      current.filter((entry) => entry.session.id !== sessionId),
    );
    setActiveSessionId((current) =>
      current === sessionId ? null : current,
    );
  }, []);

  const selectSession = useCallback((sessionId: string): void => {
    setActiveSessionId(sessionId);
  }, []);

  const write = useCallback((sessionId: string, data: string): void => {
    void window.nova?.terminal.write(sessionId, data);
  }, []);

  const resize = useCallback(
    (sessionId: string, cols: number, rows: number): void => {
      void window.nova?.terminal.resize(sessionId, cols, rows);
    },
    [],
  );

  const subscribeOutput = useCallback(
    (sessionId: string, listener: (chunk: string) => void): (() => void) => {
      const set = listeners.current.get(sessionId) ?? new Set();
      // The cursor is the position of the subscriber in the output buffer;
      // it allows a late subscriber to receive the output it missed.
      const subscription = { listener, cursor: 0 };
      set.add(subscription);
      listeners.current.set(sessionId, set);

      // Deliver the output the session produced before this subscriber
      // attached (a shell prints its first prompt immediately).
      const buffer = buffers.current.get(sessionId);
      if (buffer !== undefined && buffer.length > subscription.cursor) {
        const missed = buffer.slice(subscription.cursor).join('');
        subscription.cursor = buffer.length;
        if (missed.length > 0) {
          listener(missed);
        }
      }

      return () => {
        set.delete(subscription);
      };
    },
    [],
  );

  /**
   * Interrupts the command that is running in a session.
   *
   * Ctrl+C is sent to the shell: the command is stopped, but the session
   * stays usable.
   */
  const stop = useCallback(
    (sessionId: string): void => {
      write(sessionId, '\u0003');
    },
    [write],
  );

  return {
    sessions,
    activeSessionId,
    createSession,
    closeSession,
    selectSession,
    write,
    stop,
    resize,
    subscribeOutput,
  };
}
