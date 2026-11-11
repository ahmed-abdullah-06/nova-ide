/**
 * Problems panel (spec §6.1, §13).
 *
 * Lists the diagnostics reported by Monaco's built-in language services
 * (TypeScript/JavaScript, JSON, CSS and HTML) and lets the user jump to
 * the offending line.
 *
 * The panel never invents a diagnostic: it only shows markers that the
 * editor's language services actually reported.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  getProblems,
  severityLabel,
  subscribeProblems,
  type ProblemEntry,
} from './problemMarkers';

export type { ProblemEntry };

export interface ProblemsPanelProps {
  /** Called when a problem is activated (the file is opened at the line). */
  onOpenProblem: (entry: ProblemEntry) => void;
}

export function ProblemsPanel({
  onOpenProblem,
}: ProblemsPanelProps): React.JSX.Element {
  const problems = useSyncExternalStore(subscribeProblems, getProblems);

  const grouped = useMemo(() => {
    const groups = new Map<string, ProblemEntry[]>();
    for (const problem of problems) {
      const list = groups.get(problem.path);
      if (list === undefined) {
        groups.set(problem.path, [problem]);
      } else {
        list.push(problem);
      }
    }
    return [...groups.entries()];
  }, [problems]);

  const handleActivate = useCallback(
    (entry: ProblemEntry): void => {
      onOpenProblem(entry);
    },
    [onOpenProblem],
  );

  if (problems.length === 0) {
    return (
      <div className="problems-panel">
        <p className="problems-panel__empty">
          No problems have been reported for the open files.
        </p>
      </div>
    );
  }

  return (
    <div className="problems-panel">
      {grouped.map(([path, entries]) => (
        <section key={path} className="problems-panel__group">
          <h3 className="problems-panel__file" title={path}>
            {entries.length} problem{entries.length === 1 ? '' : 's'} in{' '}
            {shortName(path)}
          </h3>
          <ul className="problems-panel__list">
            {entries.map((entry, index) => (
              <li key={`${entry.path}:${entry.line}:${entry.column}:${index}`}>
                <button
                  type="button"
                  className={`problems-panel__item problems-panel__item--${entry.severity}`}
                  onClick={() => handleActivate(entry)}
                  title={entry.message}
                >
                  <span className="problems-panel__severity">
                    {severityLabel(entry.severity)}
                  </span>
                  <span className="problems-panel__location">
                    {entry.line}:{entry.column}
                  </span>
                  <span className="problems-panel__message">{entry.message}</span>
                  <span className="problems-panel__source">{entry.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The file name of a path (for display). */
function shortName(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index === -1 ? path : path.slice(index + 1);
}
