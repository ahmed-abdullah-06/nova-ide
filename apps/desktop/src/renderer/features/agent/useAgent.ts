/**
 * The state of the coding agent (spec §9, §13).
 *
 * The renderer never talks to a provider or to a tool: it asks the main
 * process, which streams the progress of the run through the push
 * channels.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AgentState } from '../../../shared/agent-types';

export interface AgentController {
  /** The state of the agent (the main process is the source of truth). */
  state: AgentState;
  /** Starts a run. */
  start: (
    task: string,
    providerId: string,
    model: string,
    approveCloudContext: boolean,
  ) => Promise<string | null>;
  /** Stops the running agent. */
  stop: () => Promise<void>;
  /** Answers an approval request. */
  approve: (approvalId: string, approved: boolean) => Promise<void>;
  /** Accepts a change proposal (the file is written). */
  acceptProposal: (proposalId: string) => Promise<string | null>;
  /** Rejects a change proposal. */
  rejectProposal: (proposalId: string) => Promise<void>;
  /** Accepts every change proposal of the run. */
  acceptAll: () => Promise<void>;
  /** Rejects every change proposal of the run. */
  rejectAll: () => Promise<void>;
  /** Reverts the changes of the run. */
  revert: () => Promise<void>;
  /** The message of the last error. */
  error: string | null;
  /** Sets the message of the last error. */
  setError: (message: string | null) => void;
}

/** The state of an agent that never ran. */
const EMPTY_STATE: AgentState = {
  state: 'idle',
  runId: null,
  task: '',
  providerId: '',
  model: '',
  kind: 'local',
  events: [],
  approval: null,
  proposals: [],
  revertibleRunId: null,
  summary: null,
};

export function useAgent(): AgentController {
  const [state, setState] = useState<AgentState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.agent.state().then((next) => {
      setState(next);
    });
  }, []);

  useEffect(() => {
    reload();
    const api = window.nova;
    if (!api) {
      return;
    }
    // The main process is the source of truth: the events and the state
    // arrive through the push channels.
    const unsubscribeEvents = api.agent.onEvent((payload) => {
      setState((current) => ({
        ...current,
        events: [...current.events, payload.event].slice(-200),
      }));
    });
    const unsubscribeState = api.agent.onState((next) => {
      setState(next);
    });
    return () => {
      unsubscribeEvents();
      unsubscribeState();
    };
  }, [reload]);

  const start = useCallback(
    async (
      task: string,
      providerId: string,
      model: string,
      approveCloudContext: boolean,
    ): Promise<string | null> => {
      const api = window.nova;
      if (!api) {
        return null;
      }
      setError(null);
      const result = await api.agent.start(
        task,
        providerId,
        model,
        approveCloudContext,
      );
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      reload();
      return result.value.runId;
    },
    [reload],
  );

  const stop = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || state.runId === null) {
      return;
    }
    await api.agent.cancel(state.runId);
    reload();
  }, [reload, state.runId]);

  const approve = useCallback(
    async (approvalId: string, approved: boolean): Promise<void> => {
      const api = window.nova;
      if (!api || state.runId === null) {
        return;
      }
      await api.agent.approve(state.runId, approvalId, approved);
      reload();
    },
    [reload, state.runId],
  );

  const acceptProposal = useCallback(
    async (proposalId: string): Promise<string | null> => {
      const api = window.nova;
      if (!api || state.runId === null) {
        return null;
      }
      const result = await api.agent.acceptProposal(state.runId, proposalId);
      if (!result.ok) {
        setError(result.message);
        return result.message;
      }
      setError(null);
      reload();
      return null;
    },
    [reload, state.runId],
  );

  const rejectProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      const api = window.nova;
      if (!api || state.runId === null) {
        return;
      }
      await api.agent.rejectProposal(state.runId, proposalId);
      reload();
    },
    [reload, state.runId],
  );

  const acceptAll = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || state.runId === null) {
      return;
    }
    const result = await api.agent.acceptAll(state.runId);
    if (!result.ok) {
      setError(result.message);
    }
    reload();
  }, [reload, state.runId]);

  const rejectAll = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || state.runId === null) {
      return;
    }
    await api.agent.rejectAll(state.runId);
    reload();
  }, [reload, state.runId]);

  const revert = useCallback(async (): Promise<void> => {
    const api = window.nova;
    // The checkpoint belongs to the run that really changed a file, which
    // is not always the run that is on the screen.
    const target = state.revertibleRunId ?? state.runId;
    if (!api || target === null) {
      return;
    }
    const result = await api.agent.revert(target);
    if (!result.ok) {
      setError(result.message);
    }
    reload();
  }, [reload, state.revertibleRunId, state.runId]);

  return {
    state,
    start,
    stop,
    approve,
    acceptProposal,
    rejectProposal,
    acceptAll,
    rejectAll,
    revert,
    error,
    setError,
  };
}
