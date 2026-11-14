/**
 * Tests for the planner (spec §13, milestone 6).
 *
 * The planner is advisory: the tests pin down that the plan is parsed
 * strictly, that an edit can only change a step description, that the
 * approve/edit/reject decision is explicit, and that a deviation is
 * reported but never enforced.
 */
import { describe, expect, it } from 'vitest';
import type {
  AgentPlan,
  AgentPlanStep,
} from '../../apps/desktop/src/shared/agent-types';
import {
  MAX_PLAN_DESCRIPTION_CHARS,
  MAX_PLAN_FILES,
  MAX_PLAN_STEPS,
} from '../../apps/desktop/src/shared/agent-types';
import {
  PlanTracker,
  applyPlanEdits,
  createPlan,
  decidePlan,
  degradedPlan,
  parsePlan,
} from '../../apps/desktop/src/main/agent/planner';
import {
  planDrafts,
  planDraftsValid,
  planEdits,
} from '../../apps/desktop/src/renderer/features/agent/planEdits';

/** A small plan for the tests. */
function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-1',
    runId: 'run-1',
    task: 'fix the parser',
    steps: [
      {
        id: 'step-1',
        description: 'Read the parser',
        files: ['src/parser.ts'],
        command: null,
      },
      {
        id: 'step-2',
        description: 'Run the tests',
        files: ['src/parser.ts'],
        command: 'npm run test',
      },
    ],
    state: 'pending',
    degraded: false,
    notice: null,
    createdAt: 1,
    ...overrides,
  };
}

/** A JSON plan with one step. */
const VALID_PLAN = JSON.stringify({
  steps: [
    {
      description: 'Read the parser',
      files: ['src/parser.ts'],
      command: 'npm test',
    },
  ],
});

describe('parsePlan', () => {
  it('parses a plan and gives the steps stable ids', () => {
    const parsed = parsePlan(VALID_PLAN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]).toEqual({
      id: 'step-1',
      description: 'Read the parser',
      files: ['src/parser.ts'],
      command: 'npm test',
    });
  });

  it('accepts a fenced JSON answer and text around it', () => {
    for (const text of [
      `\`\`\`json\n${VALID_PLAN}\n\`\`\``,
      `Here is the plan:\n${VALID_PLAN}\nDone.`,
    ]) {
      expect(parsePlan(text).ok).toBe(true);
    }
  });

  it('turns an empty command into null and missing files into an empty list', () => {
    const parsed = parsePlan(
      JSON.stringify({
        steps: [{ description: 'Read the code', command: '   ' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.steps[0]?.command).toBeNull();
    expect(parsed.steps[0]?.files).toEqual([]);
  });

  it('rejects a plan that is not a JSON object', () => {
    expect(parsePlan('I will read the file.').ok).toBe(false);
    expect(parsePlan('[]').ok).toBe(false);
    expect(parsePlan('"plan"').ok).toBe(false);
    expect(parsePlan('{not json}').ok).toBe(false);
  });

  it('rejects a plan without steps or with too many steps', () => {
    expect(parsePlan('{"steps":[]}').ok).toBe(false);
    expect(parsePlan('{}').ok).toBe(false);
    expect(parsePlan('{"steps":"one"}').ok).toBe(false);
    const tooMany = JSON.stringify({
      steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => ({
        description: 'step',
      })),
    });
    expect(parsePlan(tooMany).ok).toBe(false);
  });

  it('rejects a malformed step', () => {
    for (const steps of [
      ['text'],
      [null],
      [[]],
      [{ files: ['a.ts'] }],
      [{ description: '   ' }],
      [{ description: 'x'.repeat(MAX_PLAN_DESCRIPTION_CHARS + 1) }],
      [{ description: 'ok', files: 'src/a.ts' }],
      [
        {
          description: 'ok',
          files: Array.from({ length: MAX_PLAN_FILES + 1 }, () => 'a.ts'),
        },
      ],
      [{ description: 'ok', files: [1] }],
      [{ description: 'ok', files: [''] }],
      [{ description: 'ok', command: 42 }],
      [{ description: 'ok', command: 'x'.repeat(MAX_PLAN_DESCRIPTION_CHARS + 1) }],
    ]) {
      expect(parsePlan(JSON.stringify({ steps })).ok).toBe(false);
    }
  });
});

describe('createPlan', () => {
  it('returns the plan of the model on the first answer', async () => {
    const calls: string[] = [];
    const plan = await createPlan({
      task: 'fix the parser',
      runId: 'run-1',
      callModel: async (requestId) => {
        calls.push(requestId);
        return { text: VALID_PLAN };
      },
    });
    expect(calls).toEqual(['agent-plan-1']);
    expect(plan.state).toBe('pending');
    expect(plan.degraded).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.id).toMatch(/^plan-/);
  });

  it('repairs an unusable answer once', async () => {
    const calls: { id: string; messages: unknown[] }[] = [];
    const plan = await createPlan({
      task: 'fix the parser',
      runId: 'run-1',
      callModel: async (requestId, messages) => {
        calls.push({ id: requestId, messages });
        return calls.length === 1
          ? { text: 'I would read the file.' }
          : { text: VALID_PLAN };
      },
    });
    expect(calls.map((call) => call.id)).toEqual([
      'agent-plan-1',
      'agent-plan-2',
    ]);
    expect(plan.degraded).toBe(false);
    // The repair request carries the reason and the previous answer.
    expect(JSON.stringify(calls[1]?.messages)).toContain(
      'The plan could not be used',
    );
  });

  it('shows a visible minimal plan when the model never answers usably', async () => {
    let calls = 0;
    const plan = await createPlan({
      task: 'fix the parser',
      runId: 'run-1',
      callModel: async () => {
        calls += 1;
        return { text: 'no plan' };
      },
    });
    expect(calls).toBe(2);
    expect(plan.degraded).toBe(true);
    expect(plan.notice).toContain('minimal plan');
    expect(plan.state).toBe('pending');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
    expect(plan.steps[0]?.command).toBeNull();
  });

  it('treats a model error like an unusable answer and degrades', async () => {
    let calls = 0;
    const plan = await createPlan({
      task: 'fix the parser',
      runId: 'run-1',
      callModel: async () => {
        calls += 1;
        return { text: '', error: 'the provider is offline' };
      },
    });
    expect(calls).toBe(2);
    expect(plan.degraded).toBe(true);
    expect(plan.notice).toContain('provider is offline');
  });

  it('does not call the model when the run was already stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const plan = await createPlan({
      task: 'fix the parser',
      runId: 'run-1',
      signal: controller.signal,
      callModel: async () => {
        calls += 1;
        return { text: VALID_PLAN };
      },
    });
    expect(calls).toBe(0);
    expect(plan.degraded).toBe(true);
    expect(plan.notice).toContain('stopped');
  });
});

describe('degradedPlan', () => {
  it('is a usable one-step plan with a visible notice', () => {
    const plan = degradedPlan('run-1', 'fix the parser', 'no usable answer');
    expect(plan.degraded).toBe(true);
    expect(plan.notice).toBe('no usable answer');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toContain('fix the parser');
  });
});

describe('applyPlanEdits', () => {
  it('changes only the description of the named step', () => {
    const plan = makePlan();
    const edited = applyPlanEdits(plan, [
      { stepId: 'step-2', description: 'Run the focused tests' },
    ]);
    expect(edited.state).toBe('edited');
    expect(edited.steps[1]?.description).toBe('Run the focused tests');
    // The command and the files can never change through an edit.
    expect(edited.steps[1]?.command).toBe('npm run test');
    expect(edited.steps[1]?.files).toEqual(['src/parser.ts']);
    expect(edited.steps[0]).toEqual(plan.steps[0]);
  });

  it('ignores an unknown step, an empty and an over-long description', () => {
    const plan = makePlan();
    expect(applyPlanEdits(plan, [])).toBe(plan);
    expect(
      applyPlanEdits(plan, [
        { stepId: 'step-99', description: 'anything' },
        { stepId: 'step-1', description: '   ' },
        {
          stepId: 'step-2',
          description: 'x'.repeat(MAX_PLAN_DESCRIPTION_CHARS + 1),
        },
      ]),
    ).toBe(plan);
  });

  it('returns the same plan when the description did not change', () => {
    const plan = makePlan();
    expect(
      applyPlanEdits(plan, [
        { stepId: 'step-1', description: '  Read the parser  ' },
      ]),
    ).toBe(plan);
  });

  it('never takes a command, a file or a permission from an edit object', () => {
    const plan = makePlan();
    const edited = applyPlanEdits(plan, [
      {
        stepId: 'step-1',
        description: 'Read the parser',
        // A hostile extra property must be ignored: only the
        // description is part of the edit type.
        command: 'rm -rf /',
        files: ['/etc/passwd'],
      } as never,
    ]);
    expect(edited).toBe(plan);
    expect(edited.steps[0]?.command).toBeNull();
    expect(edited.steps[0]?.files).toEqual(['src/parser.ts']);
  });
});

describe('decidePlan', () => {
  it('rejects the plan and ignores the edits', () => {
    const plan = makePlan();
    const decided = decidePlan(plan, 'reject', [
      { stepId: 'step-1', description: 'Changed' },
    ]);
    expect(decided.state).toBe('rejected');
    expect(decided.steps[0]?.description).toBe('Read the parser');
  });

  it('approves an unchanged plan', () => {
    expect(decidePlan(makePlan(), 'approve').state).toBe('approved');
    expect(
      decidePlan(makePlan(), 'approve', [
        { stepId: 'step-1', description: 'Read the parser' },
      ]).state,
    ).toBe('approved');
  });

  it('approves an edited plan and keeps the new description', () => {
    const decided = decidePlan(makePlan(), 'approve', [
      { stepId: 'step-1', description: 'Read the parser carefully' },
    ]);
    expect(decided.state).toBe('edited');
    expect(decided.steps[0]?.description).toBe('Read the parser carefully');
    expect(decided.steps[1]?.description).toBe('Run the tests');
  });
});

describe('PlanTracker', () => {
  it('reports an unplanned file change once', () => {
    const tracker = new PlanTracker(makePlan());
    const message = tracker.observe('write_file', { path: 'src/other.ts' });
    expect(message).toContain('src/other.ts');
    expect(tracker.observe('write_file', { path: 'src/other.ts' })).toBeNull();
    expect(tracker.deviations).toHaveLength(1);
  });

  it('accepts a planned file change (with a normalized path)', () => {
    const tracker = new PlanTracker(makePlan());
    expect(tracker.observe('write_file', { path: 'src/parser.ts' })).toBeNull();
    expect(tracker.observe('apply_edit', { path: '.\\SRC\\Parser.ts' })).toBeNull();
    expect(tracker.deviations).toHaveLength(0);
  });

  it('never reports a read as a deviation', () => {
    const tracker = new PlanTracker(makePlan());
    expect(tracker.observe('read_file', { path: 'src/other.ts' })).toBeNull();
    expect(tracker.deviations).toHaveLength(0);
  });

  it('accepts a planned command and reports another one', () => {
    const tracker = new PlanTracker(makePlan());
    expect(tracker.observe('run_command', { script: 'test' })).toBeNull();
    const message = tracker.observe('run_command', { script: 'build' });
    expect(message).toContain('build');
    expect(message).toContain('not in the approved plan');
    expect(tracker.deviations).toHaveLength(1);
  });

  it('accepts a planned argv command', () => {
    const tracker = new PlanTracker(
      makePlan({
        steps: [
          {
            id: 'step-1',
            description: 'Inspect the version',
            files: [],
            command: 'node --version',
          },
        ],
      }),
    );
    expect(
      tracker.observe('run_command', { argv: ['node', '--version'] }),
    ).toBeNull();
    expect(tracker.deviations).toHaveLength(0);
  });

  it('does not report a command when the plan has none', () => {
    const tracker = new PlanTracker(
      makePlan({
        steps: [
          { id: 'step-1', description: 'Read', files: [], command: null },
        ],
      }),
    );
    expect(tracker.observe('run_command', { script: 'build' })).toBeNull();
    expect(tracker.deviations).toHaveLength(0);
  });

  it('never reports a deviation for a minimal (degraded) plan or no plan', () => {
    const degraded = new PlanTracker(degradedPlan('run-1', 'task', 'notice'));
    expect(degraded.observe('write_file', { path: 'src/x.ts' })).toBeNull();
    expect(degraded.deviations).toHaveLength(0);
    const none = new PlanTracker(null);
    expect(none.observe('write_file', { path: 'src/x.ts' })).toBeNull();
    expect(none.deviations).toHaveLength(0);
  });
});

describe('plan review helpers', () => {
  const step = (id: string, description: string): AgentPlanStep => ({
    id,
    description,
    files: [],
    command: null,
  });

  it('builds a draft for every step', () => {
    const plan = makePlan({ steps: [step('step-1', 'One')] });
    expect(planDrafts(plan)).toEqual({ 'step-1': 'One' });
  });

  it('returns only the edits the user really made', () => {
    const plan = makePlan();
    expect(planEdits(plan, planDrafts(plan))).toEqual([]);
    expect(
      planEdits(plan, { 'step-1': 'Read carefully', 'step-2': 'Run the tests' }),
    ).toEqual([{ stepId: 'step-1', description: 'Read carefully' }]);
  });

  it('refuses an empty or over-long description', () => {
    const plan = makePlan();
    expect(planDraftsValid(plan, { 'step-1': 'ok', 'step-2': 'ok' })).toBe(true);
    expect(planDraftsValid(plan, { 'step-1': '   ', 'step-2': 'ok' })).toBe(
      false,
    );
    expect(
      planDraftsValid(plan, {
        'step-1': 'x'.repeat(MAX_PLAN_DESCRIPTION_CHARS + 1),
        'step-2': 'ok',
      }),
    ).toBe(false);
  });
});
