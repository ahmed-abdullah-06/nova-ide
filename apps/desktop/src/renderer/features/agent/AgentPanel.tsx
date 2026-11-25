/**
 * The agent panel (spec §9, §13).
 *
 * This is the run view only: the plan, progress, approvals, proposals and
 * report. The provider/model selectors and the task composer are owned by
 * the AI panel and shared with Chat, so an agent run never shows a second
 * set of controls.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AgentRevertPreview,
  AgentRunState,
} from '../../../shared/agent-types';
import { Icon, IconButton, Popover, type IconName } from '../../components/ui';
import { useTabs } from '../../stores/tabs';
import { ProposalReview } from './ProposalReview';
import { AgentPermissionSettings } from './AgentPermissionSettings';
import { PlanReview } from './PlanReview';
import { useAgent } from './useAgent';

/** The one-line status header keeps the user-facing words short. */
const STATUS: Record<
  AgentRunState,
  { label: string; tone: string; icon: IconName }
> = {
  idle: { label: 'Idle', tone: 'idle', icon: 'info' },
  planning: { label: 'Planning', tone: 'planning', icon: 'ai' },
  waitingForPlan: { label: 'Planning', tone: 'planning', icon: 'ai' },
  running: { label: 'Running', tone: 'running', icon: 'ai' },
  waitingForApproval: {
    label: 'Waiting for approval',
    tone: 'approval',
    icon: 'shield',
  },
  completed: { label: 'Done', tone: 'success', icon: 'success' },
  failed: { label: 'Failed', tone: 'failed', icon: 'error' },
  cancelled: { label: 'Failed', tone: 'failed', icon: 'error' },
};

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function AgentPanel(): React.JSX.Element {
  const agent = useAgent();
  const tabs = useTabs();
  const [busy, setBusy] = useState(false);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [revertPreview, setRevertPreview] = useState<AgentRevertPreview | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [auditOpen, setAuditOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const state = agent.state;
  const active =
    state.runId !== null &&
    (state.state === 'planning' ||
      state.state === 'waitingForPlan' ||
      state.state === 'running' ||
      state.state === 'waitingForApproval');
  const status = STATUS[state.state];

  // The changes of the run are the ones of the active run.
  useEffect(() => {
    setOpenProposal(null);
    setRevertPreview(null);
    setConfirmed(new Set());
  }, [state.runId]);

  useEffect(() => {
    if (state.runId === null) {
      setRunStartedAt(null);
      return;
    }
    const fromEvent =
      state.events.find(
        (event) => event.runId === state.runId && event.type === 'run-started',
      )?.at ?? state.events.find((event) => event.runId === state.runId)?.at;
    setRunStartedAt(fromEvent ?? Date.now());
  }, [state.runId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

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

  const handleAnswerPlan = useCallback(
    async (
      decision: 'approve' | 'reject',
      edits: { stepId: string; description: string }[],
    ): Promise<void> => {
      if (state.plan === null) {
        return;
      }
      setBusy(true);
      await agent.answerPlan(state.plan.id, decision, edits);
      setBusy(false);
    },
    [agent, state.plan],
  );

  /** The files with unsaved changes (the main process re-checks the disk). */
  const dirtyPaths = useCallback(
    (): string[] =>
      tabs.state.tabs
        .filter((tab) => tab.isDirty && tab.filePath !== null)
        .map((tab) => tab.filePath as string),
    [tabs.state.tabs],
  );

  const handlePreviewRevert = useCallback(async (): Promise<void> => {
    setBusy(true);
    const preview = await agent.previewRevert(dirtyPaths());
    setBusy(false);
    if (preview !== null) {
      setRevertPreview(preview);
      setConfirmed(new Set());
    }
  }, [agent, dirtyPaths]);

  const handleToggleConfirm = useCallback((filePath: string): void => {
    setConfirmed((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleConfirmRevert = useCallback(async (): Promise<void> => {
    if (revertPreview === null) {
      return;
    }
    setBusy(true);
    const result = await agent.revert([...confirmed], dirtyPaths());
    setBusy(false);
    if (result !== null) {
      setRevertPreview(null);
      setConfirmed(new Set());
    }
  }, [agent, confirmed, dirtyPaths, revertPreview]);

  const revertCount =
    revertPreview === null
      ? 0
      : revertPreview.files.filter(
          (file) =>
            file.conflict === null || confirmed.has(file.path),
        ).length;

  const shown =
    state.proposals.find((proposal) => proposal.id === openProposal) ??
    state.proposals[0] ??
    null;
  const elapsed =
    active && runStartedAt !== null ? formatElapsed(now - runStartedAt) : null;

  return (
    <div className="agent-panel">
      <div className="agent-panel__status">
        <span
          className={`agent-panel__state agent-panel__state--${status.tone}`}
          data-state={state.state}
        >
          <Icon name={status.icon} size={12} />
          {status.label}
        </span>
        {state.kind === 'cloud' ? (
          <span className="ai-badge ai-badge--cloud">CLOUD</span>
        ) : null}
        {state.task.length > 0 ? (
          <span className="agent-panel__task" title={state.task}>
            {state.task}
          </span>
        ) : null}
        {elapsed !== null ? (
          <span className="agent-panel__elapsed" aria-label={`Elapsed ${elapsed}`}>
            {elapsed}
          </span>
        ) : null}
        <div className="agent-panel__status-actions">
          <div className="agent-panel__popover-anchor">
            <IconButton
              label="Agent permissions"
              icon={<Icon name="shield" size={14} />}
              size="sm"
              active={permissionsOpen}
              aria-expanded={permissionsOpen}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setAuditOpen(false);
                setPermissionsOpen((open) => !open);
              }}
            />
            <Popover
              open={permissionsOpen}
              onClose={() => setPermissionsOpen(false)}
              title="Agent permissions"
              align="end"
              className="agent-panel__popover"
            >
              <AgentPermissionSettings />
            </Popover>
          </div>
          <div className="agent-panel__popover-anchor">
            <IconButton
              label="Audit history"
              icon={<Icon name="history" size={14} />}
              size="sm"
              active={auditOpen}
              aria-expanded={auditOpen}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (!auditOpen) {
                  void agent.loadAudit();
                }
                setPermissionsOpen(false);
                setAuditOpen((open) => !open);
              }}
            />
            <Popover
              open={auditOpen}
              onClose={() => setAuditOpen(false)}
              title="Audit history"
              align="end"
              className="agent-panel__popover"
            >
              {agent.audit.length === 0 ? (
                <p className="agent-panel__audit-empty">
                  The audit history is empty. It holds metadata only.
                </p>
              ) : (
                <ol className="agent-panel__audit-list">
                  {agent.audit
                    .slice(-50)
                    .reverse()
                    .map((entry, index) => (
                      <li
                        key={`${entry.at}-${entry.step}-${index}`}
                        className="agent-panel__audit-entry"
                      >
                        <span className="agent-panel__audit-time">
                          {new Date(entry.at).toLocaleString()}
                        </span>
                        <span className="agent-panel__audit-kind">
                          {entry.kind}
                        </span>
                        <span className="agent-panel__audit-summary">
                          {entry.summary}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </Popover>
          </div>
        </div>
      </div>

      {active ? (
        <div
          className="agent-panel__progress"
          role="progressbar"
          aria-label="Agent run progress"
        />
      ) : null}

      {agent.error !== null ? (
        <p className="agent-panel__error" role="alert">
          {agent.error}
        </p>
      ) : null}

      {state.plan !== null && state.plan.state === 'pending' ? (
        <PlanReview
          plan={state.plan}
          busy={busy}
          onAnswer={(decision, edits) => void handleAnswerPlan(decision, edits)}
        />
      ) : null}

      {state.events.length > 0 ? (
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
      ) : null}

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
          {state.summary.verification !== undefined ? (
            <p
              className={`agent-panel__verification${
                state.summary.verification.verified
                  ? ' agent-panel__verification--ok'
                  : ' agent-panel__verification--unverified'
              }`}
            >
              {state.summary.verification.summary}
            </p>
          ) : null}
          <ul className="agent-panel__report-list">
            {state.summary.plan !== undefined &&
            state.summary.plan !== null ? (
              <li>
                Plan: {state.summary.plan.steps.length} step
                {state.summary.plan.steps.length === 1 ? '' : 's'} (
                {state.summary.plan.state}
                {state.summary.plan.degraded ? ', minimal' : ''})
              </li>
            ) : null}
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
            {(state.summary.deviations ?? []).map((deviation, index) => (
              <li
                key={`deviation-${index}`}
                className="agent-panel__report-issue"
              >
                Deviation from the plan: {deviation}
              </li>
            ))}
            {(state.summary.verification?.unverified ?? []).map(
              (point, index) => (
                <li
                  key={`unverified-${index}`}
                  className="agent-panel__report-error"
                >
                  Not verified: {point}
                </li>
              ),
            )}
            {(state.summary.verification?.notes ?? []).map((note, index) => (
              <li key={`note-${index}`} className="agent-panel__report-issue">
                {note}
              </li>
            ))}
          </ul>
          {state.revertibleRunId !== null ? (
            <button
              type="button"
              className="agent-panel__action"
              onClick={() => void handlePreviewRevert()}
              disabled={busy}
            >
              Revert the changes of this run…
            </button>
          ) : null}
        </div>
      ) : null}

      {revertPreview !== null ? (
        <div className="agent-panel__revert" role="dialog" aria-label="Revert the changes">
          <h4 className="agent-panel__revert-title">
            Revert {revertPreview.files.length} file
            {revertPreview.files.length === 1 ? '' : 's'}
          </h4>
          <p className="agent-panel__revert-note">
            A file that changed after the run is only overwritten when you
            confirm it.
          </p>
          <ul className="agent-panel__revert-list">
            {revertPreview.files.map((file) => (
              <li
                key={file.path}
                className={`agent-panel__revert-file${
                  file.conflict === null
                    ? ''
                    : ' agent-panel__revert-file--conflict'
                }`}
              >
                <span className="agent-panel__revert-path">
                  {file.relativePath}
                </span>
                <span className="agent-panel__revert-action">
                  {file.action === 'delete' ? 'remove' : 'restore'}
                </span>
                {file.conflict === null ? (
                  <span className="agent-panel__revert-safe">safe</span>
                ) : (
                  <label className="agent-panel__revert-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed.has(file.path)}
                      onChange={() => handleToggleConfirm(file.path)}
                    />
                    {file.conflict === 'dirty-buffer'
                      ? 'Overwrite my unsaved changes'
                      : 'Overwrite the newer edit on disk'}
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="agent-panel__revert-actions">
            <button
              type="button"
              className="agent-panel__action agent-panel__action--primary"
              onClick={() => void handleConfirmRevert()}
              disabled={busy || revertCount === 0}
            >
              Revert {revertCount} file{revertCount === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              className="agent-panel__action"
              onClick={() => {
                setRevertPreview(null);
                setConfirmed(new Set());
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
