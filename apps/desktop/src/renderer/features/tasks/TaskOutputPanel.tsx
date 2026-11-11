/**
 * Task runner panel (spec §21).
 *
 * Lists the scripts of the active workspace's `package.json`, runs them and
 * shows their output. A running task can be stopped, which terminates the
 * whole process tree.
 *
 * Only scripts declared in the workspace `package.json` can be started; the
 * renderer never sends a command line.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TaskDefinition, TaskStatus } from '../../../shared/ipc-types';

export interface TaskRunState {
  /** Id of the run (assigned by the main process). */
  taskId: string;
  /** The script that is being run. */
  name: string;
  /** The current lifecycle state. */
  status: TaskStatus;
  /** The process exit code, when the task ended. */
  exitCode: number | null;
}

export interface TaskOutputPanelProps {
  /** The scripts of the workspace `package.json`. */
  tasks: TaskDefinition[];
  /** The task that is currently running. */
  runningTask: TaskRunState | null;
  /** The captured output of the current task. */
  output: string;
  /** Starts a task. */
  onRun: (name: string) => void;
  /** Stops the running task. */
  onStop: () => void;
  /** Re-reads the script list. */
  onRefresh: () => void;
}

export function TaskOutputPanel({
  tasks,
  runningTask,
  output,
  onRun,
  onStop,
  onRefresh,
}: TaskOutputPanelProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [tasks.length]);

  const handleRun = useCallback(
    (name: string): void => {
      setError(null);
      onRun(name);
    },
    [onRun],
  );

  return (
    <div className="task-panel">
      <div className="task-panel__toolbar">
        <span className="task-panel__title">Scripts</span>
        <div className="task-panel__actions">
          <button
            type="button"
            className="task-panel__action"
            onClick={onRefresh}
            title="Reload the scripts of package.json"
          >
            Refresh
          </button>
          {runningTask !== null && runningTask.status === 'running' ? (
            <button
              type="button"
              className="task-panel__action task-panel__action--stop"
              onClick={onStop}
              title="Stop the task and its child processes"
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>

      {error !== null ? (
        <p className="task-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {tasks.length === 0 ? (
        <p className="task-panel__empty">
          This workspace has no scripts in package.json.
        </p>
      ) : (
        <ul className="task-panel__list">
          {tasks.map((task) => (
            <li key={task.name} className="task-panel__item">
              <span className="task-panel__name">{task.name}</span>
              <span className="task-panel__command" title={task.command}>
                {task.command}
              </span>
              <button
                type="button"
                className="task-panel__run"
                onClick={() => handleRun(task.name)}
                disabled={runningTask?.status === 'running'}
              >
                Run
              </button>
            </li>
          ))}
        </ul>
      )}

      {runningTask !== null ? (
        <div className="task-panel__run">
          <div className="task-panel__run-header">
            <span className="task-panel__run-name">{runningTask.name}</span>
            <span
              className={`task-panel__status task-panel__status--${runningTask.status}`}
            >
              {runningTask.status}
              {runningTask.exitCode !== null
                ? ` (exit ${runningTask.exitCode})`
                : ''}
            </span>
          </div>
          <pre className="task-panel__output">{output}</pre>
        </div>
      ) : null}
    </div>
  );
}
