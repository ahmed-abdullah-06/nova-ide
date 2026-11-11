/**
 * React binding for the diagnostics store (spec §6.1, §13).
 *
 * The store is filled by Monaco's language services; the hook only reads
 * it. It is mounted once in the application, so the badge of the problems
 * tab is correct even while the panel itself is hidden.
 */
import { useSyncExternalStore } from 'react';
import {
  getProblems,
  subscribeProblems,
  type ProblemEntry,
} from './problemMarkers';

export interface ProblemsController {
  /** All diagnostics of the open files. */
  problems: ProblemEntry[];
  /** The number of diagnostics with the severity "error". */
  errorCount: number;
  /** The number of diagnostics with the severity "warning". */
  warningCount: number;
}

export function useProblems(): ProblemsController {
  const problems = useSyncExternalStore(subscribeProblems, getProblems);
  let errorCount = 0;
  let warningCount = 0;
  for (const problem of problems) {
    if (problem.severity === 'error') {
      errorCount += 1;
    } else if (problem.severity === 'warning') {
      warningCount += 1;
    }
  }
  return { problems, errorCount, warningCount };
}
