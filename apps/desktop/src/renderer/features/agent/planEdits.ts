/**
 * The pure logic of the plan review (spec §13, milestone 6).
 *
 * Keeping the drafts and the edits in a plain module makes the behaviour
 * testable without a DOM: the component only renders these values.
 */
import type {
  AgentPlan,
  AgentPlanEdit,
} from '../../../shared/agent-types';
import { MAX_PLAN_DESCRIPTION_CHARS } from '../../../shared/agent-types';

/** The initial draft of every editable description. */
export function planDrafts(plan: AgentPlan): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const step of plan.steps) {
    drafts[step.id] = step.description;
  }
  return drafts;
}

/** The edits the user really made (an empty list when nothing changed). */
export function planEdits(
  plan: AgentPlan,
  drafts: Readonly<Record<string, string>>,
): AgentPlanEdit[] {
  const edits: AgentPlanEdit[] = [];
  for (const step of plan.steps) {
    const description = (drafts[step.id] ?? step.description).trim();
    if (description.length > 0 && description !== step.description) {
      edits.push({ stepId: step.id, description });
    }
  }
  return edits;
}

/** True when every description is non-empty and within the limit. */
export function planDraftsValid(
  plan: AgentPlan,
  drafts: Readonly<Record<string, string>>,
): boolean {
  return plan.steps.every((step) => {
    const description = (drafts[step.id] ?? '').trim();
    return (
      description.length > 0 &&
      description.length <= MAX_PLAN_DESCRIPTION_CHARS
    );
  });
}
