/**
 * The verification engine of the agent (spec §10.6, milestone 6).
 *
 * The engine does not run anything: it inspects what the run really
 * changed, which checks ran, and reports honestly when a change is not
 * verified. A claim of the model is never a check.
 *
 * Rules:
 *  - A change is verified only by a check that ran AFTER the change and
 *    passed. A test that ran before the last write proves nothing.
 *  - A proposed change that was not accepted is not a change: it is
 *    reported as pending, never as verified.
 *  - A failed or stopped command is always reported.
 *  - The plan is advisory: a difference from the plan is a note, never a
 *    failure by itself.
 */
import type {
  AgentCommandRecord,
  AgentPlan,
  AgentVerification,
  AgentVerificationCheck,
} from '../../shared/agent-types';

/** What the engine needs to verify a run. */
export interface VerificationInput {
  /** The files the run really wrote (relative paths). */
  changedFiles: readonly string[];
  /** The proposals that were not accepted (relative paths). */
  pendingProposals: readonly string[];
  /** The commands that ran during the run. */
  commands: readonly AgentCommandRecord[];
  /** The plan of the run (advisory, null when the run had none). */
  plan?: AgentPlan | null;
  /** When the last file was written (null when no file changed). */
  lastChangeAt?: number | null;
}

/** The maximum number of points in the one-line summary. */
const MAX_SUMMARY_POINTS = 3;

/** Normalizes a relative path for a comparison. */
function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

/** The label of a command in the report. */
function commandLabel(command: AgentCommandRecord): string {
  if (command.kind === 'test') {
    return `tests${command.script !== undefined ? ` "${command.script}"` : ''}`;
  }
  if (command.script !== undefined) {
    return `script "${command.script}"`;
  }
  return command.argv.join(' ') || 'command';
}

/**
 * Verifies a run.
 *
 * The result is deterministic: the same input always gives the same
 * report, so the tests can pin the behaviour down.
 */
export function buildVerification(
  input: VerificationInput,
): AgentVerification {
  const changedFiles = unique(input.changedFiles.map(normalizeDisplay));
  const pendingProposals = unique(
    input.pendingProposals.map(normalizeDisplay),
  ).filter((proposal) => !changedFiles.includes(proposal));
  const checks: AgentVerificationCheck[] = input.commands.map((command) => ({
    kind: command.kind === 'test' ? 'tests' : 'command',
    label: commandLabel(command),
    ok: command.exitCode === 0,
    exitCode: command.exitCode,
  }));
  const failedChecks = checks
    .filter((check) => !check.ok)
    .map((check) => check.label);
  const unverified: string[] = [];

  const lastChangeAt =
    typeof input.lastChangeAt === 'number' ? input.lastChangeAt : null;
  // A command without a time is treated as "before the change": an old
  // record can never verify a newer write.
  const afterChange =
    lastChangeAt === null
      ? checks
      : input.commands
          .filter((command) => (command.at ?? 0) >= lastChangeAt)
          .map(
            (command): AgentVerificationCheck => ({
              kind: command.kind === 'test' ? 'tests' : 'command',
              label: commandLabel(command),
              ok: command.exitCode === 0,
              exitCode: command.exitCode,
            }),
          );

  if (pendingProposals.length > 0) {
    unverified.push(
      `${pendingProposals.length} proposed change(s) were not accepted and were not written.`,
    );
  }

  let verified = pendingProposals.length === 0;
  if (changedFiles.length === 0) {
    verified = verified && failedChecks.length === 0;
    if (failedChecks.length > 0) {
      unverified.unshift(`A check failed: ${failedChecks[0]}.`);
    }
  } else if (afterChange.length === 0) {
    verified = false;
    unverified.unshift(
      'No check ran after the files were changed: the changes are not verified.',
    );
  } else {
    const last = afterChange[afterChange.length - 1];
    if (last !== undefined && last.ok) {
      verified = true;
    } else {
      verified = false;
      unverified.unshift(
        `The last check after the changes failed (${last?.label ?? 'unknown'}).`,
      );
    }
  }

  for (const command of input.commands) {
    if (command.exitCode === null) {
      unverified.push(`"${commandLabel(command)}" was stopped before it finished.`);
    }
  }

  const notes = planNotes(input.plan ?? null, changedFiles);

  return {
    changedFiles,
    pendingProposals,
    checks,
    failedChecks,
    unverified: unique(unverified).slice(0, 20),
    notes,
    verified,
    summary: summarize(verified, changedFiles, unverified, failedChecks),
  };
}

/** Compares the plan with what really happened (advisory notes only). */
function planNotes(
  plan: AgentPlan | null,
  changedFiles: readonly string[],
): string[] {
  if (plan === null || plan.degraded) {
    return [];
  }
  const expected = unique(
    plan.steps.flatMap((step) => step.files.map(normalizeDisplay)),
  );
  if (expected.length === 0) {
    return [];
  }
  const actual = new Set(changedFiles.map(normalizePath));
  const unexpected = changedFiles.filter(
    (file) => !expected.some((entry) => normalizePath(entry) === normalizePath(file)),
  );
  const untouched = expected.filter((file) => !actual.has(normalizePath(file)));
  const notes: string[] = [];
  if (unexpected.length > 0) {
    notes.push(
      `The agent changed file(s) outside the plan: ${unexpected.join(', ')}.`,
    );
  }
  if (untouched.length > 0) {
    notes.push(
      `The plan named file(s) that did not change: ${untouched.join(', ')}.`,
    );
  }
  return notes;
}

/** A one-line statement that never overclaims. */
function summarize(
  verified: boolean,
  changedFiles: readonly string[],
  unverified: readonly string[],
  failedChecks: readonly string[],
): string {
  if (changedFiles.length === 0 && unverified.length === 0) {
    return 'Nothing to verify: the run did not change a file and every check passed.';
  }
  if (changedFiles.length === 0) {
    return `No file changed, but the run is not fully verified: ${unverified
      .slice(0, MAX_SUMMARY_POINTS)
      .join(' ')}`.slice(0, 400);
  }
  if (verified) {
    return (
      `Verified: ${changedFiles.length} file${
        changedFiles.length === 1 ? '' : 's'
      } changed and the last check passed.` +
      (failedChecks.length > 0
        ? ` (${failedChecks.length} earlier check(s) failed.)`
        : '')
    ).slice(0, 400);
  }
  return `Not verified: ${unverified
    .slice(0, MAX_SUMMARY_POINTS)
    .join(' ')}`.slice(0, 400);
}

/** Removes duplicates but keeps the order. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The display form of a path (the separators of the workspace). */
function normalizeDisplay(value: string): string {
  return value.trim().replace(/\\/g, '/');
}
