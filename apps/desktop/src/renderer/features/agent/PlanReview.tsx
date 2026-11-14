/**
 * The review of the plan of a run (spec §13, milestone 6).
 *
 * The plan is shown before the first tool call. The user can approve it,
 * edit a step description and then approve, or reject it. The commands
 * and the files of a step are read-only here: a plan is advisory and can
 * never change a permission or a command.
 */
import { useEffect, useState } from 'react';
import type {
  AgentPlan,
  AgentPlanDecision,
  AgentPlanEdit,
} from '../../../shared/agent-types';
import { MAX_PLAN_DESCRIPTION_CHARS } from '../../../shared/agent-types';
import { planDrafts, planDraftsValid, planEdits } from './planEdits';

export interface PlanReviewProps {
  /** The plan that waits for an answer. */
  plan: AgentPlan;
  /** True while another action is in progress. */
  busy: boolean;
  /** Sends the answer to the main process. */
  onAnswer: (decision: AgentPlanDecision, edits: AgentPlanEdit[]) => void;
}

export function PlanReview({
  plan,
  busy,
  onAnswer,
}: PlanReviewProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    planDrafts(plan),
  );

  // A new plan starts with fresh drafts.
  useEffect(() => {
    setDrafts(planDrafts(plan));
  }, [plan.id]);

  const edits = planEdits(plan, drafts);
  const valid = planDraftsValid(plan, drafts);
  const edited = edits.length > 0;

  return (
    <div
      className={`agent-panel__plan${
        plan.degraded ? ' agent-panel__plan--degraded' : ''
      }`}
      role="region"
      aria-label="The plan of the agent"
    >
      <header className="agent-panel__plan-header">
        <h4 className="agent-panel__plan-title">Plan</h4>
        <span className="agent-panel__plan-count">
          {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}
        </span>
        {plan.degraded ? (
          <span className="agent-panel__plan-badge">minimal</span>
        ) : null}
      </header>

      {plan.notice !== null ? (
        <p className="agent-panel__plan-notice" role="alert">
          {plan.notice}
        </p>
      ) : null}

      <p className="agent-panel__plan-note">
        Review the plan before the agent starts. You can edit a step
        description; the files and the commands are only informative, and
        the permission rules still apply to every tool call.
      </p>

      <ol className="agent-panel__plan-steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className="agent-panel__plan-step">
            <label className="agent-panel__plan-label">
              <span className="agent-panel__plan-index">{index + 1}.</span>
              <textarea
                className="agent-panel__plan-description"
                aria-label={`Description of step ${index + 1}`}
                value={drafts[step.id] ?? ''}
                maxLength={MAX_PLAN_DESCRIPTION_CHARS}
                rows={2}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => ({ ...current, [step.id]: value }));
                }}
              />
            </label>
            {step.files.length > 0 ? (
              <p className="agent-panel__plan-meta">
                Files: {step.files.join(', ')}
              </p>
            ) : null}
            {step.command !== null ? (
              <code className="agent-panel__plan-command">{step.command}</code>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="agent-panel__plan-actions">
        <button
          type="button"
          className="agent-panel__action agent-panel__action--primary"
          disabled={busy || !valid}
          onClick={() => onAnswer('approve', edits)}
        >
          {edited ? 'Approve edited plan' : 'Approve plan'}
        </button>
        <button
          type="button"
          className="agent-panel__action"
          disabled={busy}
          onClick={() => onAnswer('reject', [])}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
