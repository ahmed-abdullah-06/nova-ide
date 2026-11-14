/**
 * Tests for the verification engine (spec §10.6, milestone 6).
 *
 * The engine only trusts a check that ran after the change: a passing
 * test that ran before the last write never verifies anything.
 */
import { describe, expect, it } from 'vitest';
import type {
  AgentCommandRecord,
  AgentPlan,
} from '../../apps/desktop/src/shared/agent-types';
import { buildVerification } from '../../apps/desktop/src/main/agent/verification';

/** A command record. */
function command(
  overrides: Partial<AgentCommandRecord> = {},
): AgentCommandRecord {
  return {
    argv: ['npm', 'run', 'test'],
    script: 'test',
    exitCode: 0,
    summary: 'ok',
    at: 100,
    kind: 'test',
    ...overrides,
  };
}

/** A small plan. */
function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-1',
    runId: 'run-1',
    task: 'fix the parser',
    steps: [
      {
        id: 'step-1',
        description: 'Change the parser',
        files: ['src/parser.ts'],
        command: null,
      },
    ],
    state: 'approved',
    degraded: false,
    notice: null,
    createdAt: 1,
    ...overrides,
  };
}

describe('buildVerification', () => {
  it('reports honestly that nothing had to be verified', () => {
    const report = buildVerification({
      changedFiles: [],
      pendingProposals: [],
      commands: [],
    });
    expect(report.verified).toBe(true);
    expect(report.summary).toContain('Nothing to verify');
    expect(report.unverified).toEqual([]);
    expect(report.checks).toEqual([]);
  });

  it('does not verify a change without a check', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(false);
    expect(report.changedFiles).toEqual(['src/parser.ts']);
    expect(report.summary).toContain('Not verified');
    expect(report.unverified[0]).toContain('No check ran after');
  });

  it('verifies a change with a check that ran after it and passed', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(true);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({
      kind: 'tests',
      ok: true,
      exitCode: 0,
    });
    expect(report.summary).toContain('Verified');
  });

  it('does not trust a check that ran before the change', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [command({ at: 50 })],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(false);
    expect(report.unverified[0]).toContain('No check ran after');
  });

  it('does not verify when the last check after the change failed', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [
        command({ at: 110 }),
        command({ at: 120, exitCode: 1, summary: '3 tests failed' }),
      ],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(false);
    expect(report.failedChecks).toHaveLength(1);
    expect(report.unverified[0]).toContain('last check');
  });

  it('accepts a later passing check after a failure', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [
        command({ at: 110, exitCode: 1 }),
        command({ at: 120, exitCode: 0 }),
      ],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(true);
    expect(report.failedChecks).toHaveLength(1);
    expect(report.summary).toContain('Verified');
    expect(report.summary).toContain('earlier check');
  });

  it('never counts a pending proposal as a change', () => {
    const report = buildVerification({
      changedFiles: [],
      pendingProposals: ['src/parser.ts'],
      commands: [],
    });
    expect(report.verified).toBe(false);
    expect(report.pendingProposals).toEqual(['src/parser.ts']);
    expect(report.unverified.join(' ')).toContain('not accepted');
  });

  it('removes an accepted proposal from the pending list', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: ['src/parser.ts'],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
    });
    expect(report.pendingProposals).toEqual([]);
  });

  it('reports a stopped command', () => {
    const report = buildVerification({
      changedFiles: [],
      pendingProposals: [],
      commands: [command({ exitCode: null, at: 120 })],
    });
    expect(report.verified).toBe(false);
    expect(report.unverified.join(' ')).toContain('stopped');
  });

  it('reports a failed check even when no file changed', () => {
    const report = buildVerification({
      changedFiles: [],
      pendingProposals: [],
      commands: [command({ exitCode: 1 })],
    });
    expect(report.verified).toBe(false);
    expect(report.summary).toContain('not fully verified');
    expect(report.unverified.join(' ')).toContain('A check failed');
  });

  it('treats a legacy command without a time as before the change', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts'],
      pendingProposals: [],
      commands: [command({ at: undefined })],
      lastChangeAt: 100,
    });
    expect(report.verified).toBe(false);
  });

  it('compares the plan with the actual changes as notes only', () => {
    const report = buildVerification({
      changedFiles: ['src/parser.ts', 'src/other.ts'],
      pendingProposals: [],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
      plan: plan(),
    });
    expect(report.verified).toBe(true);
    expect(report.notes.join(' ')).toContain('src/other.ts');
    expect(report.notes.join(' ')).toContain('outside the plan');
  });

  it('notes a planned file that did not change', () => {
    const report = buildVerification({
      changedFiles: ['src/other.ts'],
      pendingProposals: [],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
      plan: plan({
        steps: [
          {
            id: 'step-1',
            description: 'Change the parser',
            files: ['src/parser.ts'],
            command: null,
          },
        ],
      }),
    });
    expect(report.notes.length).toBe(2);
    expect(report.notes.join(' ')).toContain('did not change');
  });

  it('does not compare a degraded plan', () => {
    const report = buildVerification({
      changedFiles: ['src/other.ts'],
      pendingProposals: [],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
      plan: plan({ degraded: true }),
    });
    expect(report.notes).toEqual([]);
  });

  it('normalizes the separators of the paths', () => {
    const report = buildVerification({
      changedFiles: ['src\\parser.ts'],
      pendingProposals: [],
      commands: [command({ at: 120 })],
      lastChangeAt: 100,
      plan: plan(),
    });
    expect(report.changedFiles).toEqual(['src/parser.ts']);
    expect(report.notes).toEqual([]);
  });
});
