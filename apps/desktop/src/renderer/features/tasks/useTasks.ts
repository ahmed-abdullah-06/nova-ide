/**
 * Task runner state for the renderer (spec §21).
 *
 * The renderer can only start a script that the workspace `package.json`
 * declares — the main process resolves the command itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TaskDefinition,
  TaskOutput,
  TaskStatus,
  TaskStatusEvent,
} from '../../../shared/ipc-types';

/** The state of the task that is currently running. */
export interface RunningTask {
  taskId: string;
  name: string;
  status: TaskStatus;
  exitCode: number | null;
}

export interface TaskController {
  /** The scripts of the workspace `package.json`. */
  tasks: TaskDefinition[];
  /** The task that is currently running (or was the last one). */
  runningTask: RunningTask | null;
  /** The captured output of the current task. */
  output: string;
  /** The last error message. */
  error: string | null;
  /** Starts a script by name. */
  run: (name: string) => void;
  /** Stops the running task. */
  stop: () => void;
  /** Re-reads the script list. */
  refresh: () => void;
}

/** Maximum number of output characters kept in the renderer. */
const MAX_OUTPUT_CHARS = 200_000;

export function useTasks(enabled: boolean): TaskController {
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [runningTask, setRunningTask] = useState<RunningTask | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef('');

  const refresh = useCallback((): void => {
    const api = window.nova;
    if (!api || !enabled) {
      setTasks([]);
      return;
    }
    void api.task.list().then((result) => {
      if (result.ok) {
        setTasks(result.value);
        setError(null);
      } else {
        setTasks([]);
        setError(result.message);
      }
    });
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to the output and the status of the running task.
  useEffect(() => {
    const api = window.nova;
    if (!api) {
      return;
    }
    const unsubscribeOutput = api.task.onOutput((event: TaskOutput) => {
      outputRef.current = `${outputRef.current}${event.chunk}`;
      if (outputRef.current.length > MAX_OUTPUT_CHARS) {
        outputRef.current = outputRef.current.slice(-MAX_OUTPUT_CHARS);
      }
      setOutput(outputRef.current);
    });
    const unsubscribeStatus = api.task.onStatus((event: TaskStatusEvent) => {
      setRunningTask((current) =>
        current !== null && current.taskId === event.taskId
          ? { ...current, status: event.status, exitCode: event.exitCode }
          : current,
      );
    });
    return () => {
      unsubscribeOutput();
      unsubscribeStatus();
    };
  }, []);

  const run = useCallback((name: string): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    setError(null);
    outputRef.current = '';
    setOutput('');
    void api.task.run(name).then((result) => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRunningTask({
        taskId: result.value.taskId,
        name,
        status: 'running',
        exitCode: null,
      });
    });
  }, []);

  const stop = useCallback((): void => {
    const current = runningTask;
    if (current === null) {
      return;
    }
    void window.nova?.task.cancel(current.taskId);
  }, [runningTask]);

  return { tasks, runningTask, output, error, run, stop, refresh };
}
