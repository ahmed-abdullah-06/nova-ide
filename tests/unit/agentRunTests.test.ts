/**
 * Tests for the run_tests tool (spec §10.6, §12, milestone 6).
 *
 * The test suite of the workspace always comes from the package.json and
 * the command still needs the approval of the user. The result is
 * recorded as a test, so the verification engine can trust it.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOLS,
  ToolRegistry,
} from '../../apps/desktop/src/main/agent/tools';
import { ToolExecutor } from '../../apps/desktop/src/main/agent/toolExecutor';
import {
  AGENT_TOOL_NAMES,
  type AgentPermissionSettings,
} from '../../apps/desktop/src/main/agent/permissions';

/** A fake task runner: it reports the final status on the next tick. */
function fakeTasks(exitCode: number | null = 0) {
  let started: string | null = null;
  type OutputListener = (output: { taskId: string; chunk: string }) => void;
  type StatusListener = (status: {
    taskId: string;
    status: 'running' | 'success' | 'failed' | 'cancelled';
    exitCode: number | null;
  }) => void;
  const outputListeners = new Set<OutputListener>();
  const statusListeners = new Set<StatusListener>();
  return {
    started: () => started,
    tasks: {
      run: async (name: string) => {
        started = name;
        setTimeout(() => {
          for (const listener of statusListeners) {
            listener({
              taskId: 'task-1',
              status: exitCode === 0 ? 'success' : 'failed',
              exitCode,
            });
          }
        }, 0);
        return { ok: true as const, value: { taskId: 'task-1' } };
      },
      subscribeOutput: (listener: OutputListener) => {
        outputListeners.add(listener);
        return () => {
          outputListeners.delete(listener);
        };
      },
      subscribeStatus: (listener: StatusListener) => {
        statusListeners.add(listener);
        return () => {
          statusListeners.delete(listener);
        };
      },
      cancel: async () => ({ ok: true as const, value: undefined }),
    },
    emitOutput: (chunk: string): void => {
      for (const listener of outputListeners) {
        listener({ taskId: 'task-1', chunk });
      }
    },
  };
}

/** The context of a test run. */
function fakeContext(approved = true, allowedLevels: string[] = ['read']) {
  const approvals: {
    kind: string;
    tool: string;
    script?: string;
    argv?: string[];
  }[] = [];
  const commands: {
    argv: string[];
    script?: string;
    exitCode: number | null;
    summary: string;
    at?: number;
    kind?: 'command' | 'test';
  }[] = [];
  const context = {
    runId: 'run-1',
    root: 'C:\\work',
    signal: new AbortController().signal,
    settings: {
      allowedLevels,
      allowCloudContext: false,
    } as AgentPermissionSettings,
    requestApproval: async (request: {
      kind: string;
      tool: string;
      script?: string;
      argv?: string[];
    }) => {
      approvals.push(request);
      return approved;
    },
    createProposal: () => {
      throw new Error('not used');
    },
    commands,
    inspected: [],
  };
  return { context, approvals };
}

/** Builds the executor with a fake task runner. */
function build(exitCode: number | null = 0) {
  const fake = fakeTasks(exitCode);
  fake.emitOutput('22 tests passed');
  return {
    ...fake,
    executor: new ToolExecutor({
      files: {} as never,
      search: {} as never,
      git: {} as never,
      tasks: fake.tasks as never,
    }),
  };
}

const RUN_TESTS = AGENT_TOOLS.find((tool) => tool.name === 'run_tests');

describe('run_tests', () => {
  it('is registered as a command tool', () => {
    expect(RUN_TESTS).toBeDefined();
    expect(RUN_TESTS?.level).toBe('command');
    expect(AGENT_TOOL_NAMES).toContain('run_tests');
    expect(new ToolRegistry().get('run_tests')).toBeDefined();
  });

  it('runs the default test script after an explicit approval', async () => {
    const { executor, started } = build(0);
    const { context, approvals } = fakeContext();
    const result = await executor.execute(
      RUN_TESTS!,
      {},
      context as never,
    );

    expect(started()).toBe('test');
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ tool: 'run_tests', script: 'test' });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('passed');
    expect(result.command).toMatchObject({
      argv: ['npm', 'run', 'test'],
      script: 'test',
      exitCode: 0,
      kind: 'test',
    });
    expect(typeof result.command?.at).toBe('number');
    expect(context.commands).toHaveLength(1);
  });

  it('runs a named test script of the package.json', async () => {
    const { executor, started } = build(0);
    const { context } = fakeContext();
    const result = await executor.execute(
      RUN_TESTS!,
      { script: 'test:unit' },
      context as never,
    );
    expect(started()).toBe('test:unit');
    expect(result.ok).toBe(true);
    expect(result.command?.kind).toBe('test');
  });

  it('does not run when the user denies the approval', async () => {
    const { executor, started } = build(0);
    const { context, approvals } = fakeContext(false);
    const result = await executor.execute(
      RUN_TESTS!,
      {},
      context as never,
    );
    expect(approvals).toHaveLength(1);
    expect(started()).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected');
  });

  it('does not ask when the command category was widened', async () => {
    const { executor } = build(0);
    const { context, approvals } = fakeContext(true, ['read', 'command']);
    const result = await executor.execute(
      RUN_TESTS!,
      {},
      context as never,
    );
    expect(approvals).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid script name before anything runs', async () => {
    const { executor, started } = build(0);
    const { context, approvals } = fakeContext();
    const result = await executor.execute(
      RUN_TESTS!,
      { script: 'test && rm -rf /' },
      context as never,
    );
    expect(approvals).toHaveLength(0);
    expect(started()).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid arguments');
  });

  it('reports a failing test suite and keeps the record', async () => {
    const { executor } = build(1);
    const { context } = fakeContext();
    const result = await executor.execute(
      RUN_TESTS!,
      {},
      context as never,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('did not pass');
    expect(result.command).toMatchObject({ exitCode: 1, kind: 'test' });
    expect(context.commands).toHaveLength(1);
  });
});
