/**
 * Agent IPC handlers (spec §9, §19.2).
 *
 * The handlers are thin: they validate the arguments and delegate to the
 * agent service. The renderer never supplies file content or a command —
 * it only names a run, answers an approval and accepts a proposal.
 */
import type { IpcInvokeMap } from '../../shared/ipc-types';
import type { AgentService } from '../agent/agentService';

type Handler<C extends keyof IpcInvokeMap> = (
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']>;

export interface AgentHandlers {
  start: Handler<'agent:start'>;
  cancel: Handler<'agent:cancel'>;
  state: Handler<'agent:state'>;
  approve: Handler<'agent:approve'>;
  acceptProposal: Handler<'agent:proposal-accept'>;
  rejectProposal: Handler<'agent:proposal-reject'>;
  acceptAll: Handler<'agent:proposals-accept-all'>;
  rejectAll: Handler<'agent:proposals-reject-all'>;
  previewRevert: Handler<'agent:revert-preview'>;
  revert: Handler<'agent:revert'>;
  audit: Handler<'agent:audit'>;
}

export function createAgentHandlers(agent: AgentService): AgentHandlers {
  return {
    start: async (task, providerId, model, approveCloudContext) => {
      const result = await agent.start(task, providerId, model, {
        approveCloudContext,
      });
      if (!result.ok) {
        return {
          ok: false,
          code: 'UNKNOWN',
          message: result.message,
        };
      }
      return { ok: true, value: { runId: result.runId } };
    },
    cancel: async (runId) => {
      const result = agent.cancel(runId);
      return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, code: 'NOT_FOUND', message: result.message ?? 'unknown' };
    },
    state: async () => agent.getState(),
    approve: async (runId, approvalId, approved) => {
      const result = agent.approve(runId, approvalId, approved);
      return result.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            code: 'NOT_FOUND',
            message: 'The approval request does not exist.',
          };
    },
    acceptProposal: async (runId, proposalId) => {
      const result = await agent.acceptProposal(runId, proposalId);
      return result.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            code: 'CONFLICT',
            message: result.message ?? 'The change could not be written.',
          };
    },
    rejectProposal: async (runId, proposalId) => {
      const result = agent.rejectProposal(runId, proposalId);
      return result.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            code: 'NOT_FOUND',
            message: 'The change does not exist.',
          };
    },
    acceptAll: async (runId) => {
      const result = await agent.acceptAll(runId);
      return result.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            code: 'CONFLICT',
            message: result.message ?? 'The changes could not be written.',
          };
    },
    rejectAll: async (runId) => {
      const result = agent.rejectAll(runId);
      return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, code: 'NOT_FOUND', message: 'The run is not active.' };
    },
    previewRevert: async (runId, dirtyPaths) => {
      const result = await agent.previewRevert(runId, dirtyPaths);
      return result.ok
        ? { ok: true, value: result.preview }
        : { ok: false, code: 'NOT_FOUND', message: result.message };
    },
    revert: async (runId, confirmedPaths, dirtyPaths) => {
      const result = await agent.revertRun(runId, confirmedPaths, dirtyPaths);
      if (result.ok) {
        return {
          ok: true,
          value: result.result ?? { restored: 0, skipped: [] },
        };
      }
      return {
        ok: false,
        code: result.result === undefined ? 'NOT_FOUND' : 'CONFLICT',
        message: result.message ?? 'The run could not be reverted.',
      };
    },
    audit: async () => agent.getAudit(),
  };
}
