/**
 * Severity handling of the problems panel (spec §6.1, §13).
 *
 * The mapping is kept free of any runtime dependency on Monaco, so it can
 * be unit tested in a plain Node environment. The values are the bit flags
 * of Monaco's `MarkerSeverity` enum; the module that talks to Monaco
 * asserts that they still match (see `problemMarkers.ts`).
 */

/** The bit flags of Monaco's `MarkerSeverity` enum. */
export const MONACO_SEVERITY = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

/** The severity of a problem as shown in the problems list. */
export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Maps a Monaco severity to the severity of the problems list.
 *
 * Monaco encodes the severities as bit flags, so the highest matching flag
 * wins (an error that also carries a warning is shown as an error).
 */
export function toSeverity(severity: number): ProblemSeverity {
  if ((severity & MONACO_SEVERITY.Error) !== 0) {
    return 'error';
  }
  if ((severity & MONACO_SEVERITY.Warning) !== 0) {
    return 'warning';
  }
  if ((severity & MONACO_SEVERITY.Info) !== 0) {
    return 'info';
  }
  return 'hint';
}

/** Human-readable label of a severity. */
export function severityLabel(severity: ProblemSeverity): string {
  switch (severity) {
    case 'error':
      return 'Error';
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Info';
    default:
      return 'Hint';
  }
}
