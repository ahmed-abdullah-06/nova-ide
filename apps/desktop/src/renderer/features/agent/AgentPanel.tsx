/**
 * The agent panel (spec §9, §13).
 *
 * The panel shows the task, the provider and the model (with the LOCAL
 * or CLOUD badge), the progress of the run, the approvals the user has
 * to give, the changes the agent proposes and the final report.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProviderDescriptor } from '../../../shared/ai-types';
import { ProposalReview } from './ProposalReview';
import { useAgent } from './useAgent';

export interface AgentPanelProps {
  /** The providers the user can choose from. */
  providers: ProviderDescriptor[];
  /** The models of the selected provider. */
  models: { id: string; name: string }[];
  /** The selected provider. */
  providerId: string | null;
  /** The selected model. */
  model: string;
  /** Selects a provider. */
  onSelectProvider: (providerId: string) => void;
  /** Selects a model. */
  onSelectModel: (model: string) => void;
}

export function AgentPanel({
  providers,
  models,
  providerId,
  model,
  onSelectProvider,
  onSelectModel,
}: AgentPanelProps): React.JSX.Element {
  const agent = useAgent();
  const [task, setTask] = useState('');
  const [approveCloud, setApproveCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openProposal, setOpenProposal] = useState<string | null>(null);

  const state = agent.state;
  const provider = providers.find((entry) => entry.id === providerId) ?? null;
  const isCloud = provider?.kind === 'cloud';
  const running = state.state === 'running' || state.state === 'waitingForApproval';

  // The changes of the run are the ones of the active run.
  useEffect(() => {
    setOpenProposal(null);
  }, [state.runId]);

  const handleStart = useCallback(async (): Promise<void> => {
    if (providerId === null || model.length === 0) {
      agent.setError('Choose a provider and a model first.');
      return;
    }
    setBusy(true);
    const runId = await agent.start(task, providerId, model, approveCloud);
    setBusy(false);
    if (runId === null) {
      return;
    }
    setTask('');
    setApproveCloud(false);
  }, [agent, approveCloud, model, providerId, task]);

  const handleAccept = useCallback(
    async (proposalId: string): Promise<void> => {
      setBusy(true);
      const error = await agent.acceptProposal(proposalId);
      setBusy(false);
      if (error === null) {
        setOpenProposal(null);
      }
    },
    [agent],
  );

  const shown =
    state.proposals.find((proposal) => proposal.id === openProposal) ??
    state.proposals[0] ??
    null;

  return (
    <div className="agent-panel">
      <div className="agent-panel__controls">
        <select
          className="agent-panel__select"
          aria-label="Provider"
          value={providerId ?? ''}
          onChange={(event) => onSelectProvider(event.target.value)}
        >
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <select
          className="agent-panel__select"
          aria-label="Model"
          value={model}
          disabled={models.length === 0}
          onChange={(event) => onSelectModel(event.target.value)}
        >
          {models.length === 0 ? <option value="">No models</option> : null}
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {provider !== null ? (
          <span
            className={`ai-badge ai-badge--${provider.kind}`}
            title={
              provider.kind === 'local'
                ? 'Everything stays on this machine'
                : 'The content of the workspace is sent to this service'
            }
          >
            {provider.kind === 'local' ? 'LOCAL' : 'CLOUD'}
          </span>
        ) : null}
      </div>

      {state.state !== 'idle' ? (
        <div className="agent-panel__status">
          <span className={`agent-panel__state agent-panel__state--${state.state}`}>
            {state.state}
          </span>
          {state.kind === 'cloud' ? (
            <span className="ai-badge ai-badge--cloud">CLOUD</span>
          ) : null}
          {state.task.length > 0 ? (
            <span className="agent-panel__task">{state.task}</span>
          ) : null}
        </div>
      ) : null}

      {agent.error !== null ? (
        <p className="agent-panel__error" role="alert">
          {agent.error}
        </p>
      ) : null}

      <div className="agent-panel__timeline">
        {state.events.map((event) => (
          <div
            key={`${event.step}-${event.at}-${event.type}`}
            className={`agent-panel__event agent-panel__event--${event.type}`}
          >
            {event.tool !== undefined ? (
              <span className="agent-panel__event-tool">{event.tool}</span>
            ) : null}
            <span className="agent-panel__event-summary">{event.summary}</span>
            {event.error !== undefined ? (
              <span className="agent-panel__event-error">{event.error}</span>
            ) : null}
          </div>
        ))}
      </div>

      {state.approval !== null ? (
        <div className="agent-panel__approval" role="alert">
          <p className="agent-panel__approval-reason">
            {state.approval.reason}
          </p>
          {state.approval.script !== undefined ? (
            <code className="agent-panel__approval-command">
              npm run {state.approval.script}
            </code>
          ) : null}
          {state.approval.argv !== undefined ? (
            <code className="agent-panel__approval-command">
              {state.approval.argv.join(' ')}
            </code>
          ) : null}
          {state.approval.kind === 'cloud-context' ? (
            <p className="agent-panel__approval-scope">
              The provider {state.approval.providerId} (
              {state.approval.model}) would receive:{' '}
              {(state.approval.scope ?? []).join(', ')}.
            </p>
          ) : null}
          <div className="agent-panel__approval-actions">
            <button
              type="button"
              className="agent-panel__accept"
              onClick={() => void agent.approve(state.approval?.id ?? '', true)}
            >
              Allow
            </button>
            <button
              type="button"
              className="agent-panel__reject"
              onClick={() => void agent.approve(state.approval?.id ?? '', false)}
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}

      {state.proposals.length > 0 ? (
        <div className="agent-panel__proposals">
          <header className="agent-panel__proposals-header">
            <span>
              {state.proposals.length} proposed change
              {state.proposals.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="agent-panel__action"
              onClick={() => void agent.acceptAll()}
              disabled={busy}
            >
              Accept all
            </button>
            <button
              type="button"
              className="agent-panel__action"
              onClick={() => void agent.rejectAll()}
              disabled={busy}
            >
              Reject all
            </button>
          </header>
          <ul className="agent-panel__proposal-list">
            {state.proposals.map((proposal) => (
              <li key={proposal.id}>
                <button
                  type="button"
                  className="agent-panel__proposal-path"
                  onClick={() => setOpenProposal(proposal.id)}
                >
                  {proposal.relativePath}
                </button>
              </li>
            ))}
          </ul>
          {shown !== null ? (
            <ProposalReview
              proposal={shown}
              busy={busy}
              onAccept={() => void handleAccept(shown.id)}
              onReject={() => void agent.rejectProposal(shown.id)}
            />
          ) : null}
        </div>
      ) : null}

      {state.summary !== null && state.summary.state !== 'running' ? (
        <div className="agent-panel__report">
          <h4 className="agent-panel__report-title">Report</h4>
          {state.summary.finalMessage.length > 0 ? (
            <p className="agent-panel__report-final">
              {state.summary.finalMessage}
            </p>
          ) : null}
          <ul className="agent-panel__report-list">
            <li>
              {state.summary.steps} step
              {state.summary.steps === 1 ? '' : 's'}, {state.summary.inspected.length}{' '}
              file{state.summary.inspected.length === 1 ? '' : 's'} inspected,{' '}
              {state.summary.commands.length} command
              {state.summary.commands.length === 1 ? '' : 's'} run
            </li>
            {state.summary.commands.map((command) => (
              <li key={command.argv.join(' ')} className="agent-panel__report-command">
                {command.argv.join(' ')} → exit {command.exitCode ?? 'none'}
              </li>
            ))}
            {state.summary.errors.map((error, index) => (
              <li key={`error-${index}`} className="agent-panel__report-error">
                {error}
              </li>
            ))}
            {state.summary.unresolved.map((issue, index) => (
              <li key={`issue-${index}`} className="agent-panel__report-issue">
                {issue}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="agent-panel__action"
            onClick={() => void agent.revert()}
            disabled={busy}
          >
            Revert the changes of this run
          </button>
        </div>
      ) : null}

      <div className="agent-panel__composer">
        <textarea
          className="agent-panel__input"
          placeholder="What should the agent do?"
          aria-label="Task for the agent"
          value={task}
          disabled={running}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleStart();
            }
          }}
        />
        {isCloud ? (
          <label className="agent-panel__cloud-approval">
            <input
              type="checkbox"
              checked={approveCloud}
              onChange={(event) => setApproveCloud(event.target.checked)}
            />
            Allow this run to send the content of the workspace to{' '}
            {provider?.name ?? 'the cloud provider'}
          </label>
        ) : null}
        <div className="agent-panel__actions">
          <button
            type="button"
            className="agent-panel__action agent-panel__action--primary"
            onClick={() => void handleStart()}
            disabled={running || busy || task.trim().length === 0}
          >
            Start
          </button>
          <button
            type="button"
            className="agent-panel__action"
            onClick={() => void agent.stop()}
            disabled={!running}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
