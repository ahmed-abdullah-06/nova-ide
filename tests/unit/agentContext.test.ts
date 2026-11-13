/**
 * Tests for the context manager (spec §10.2, §19.1, M5 C2).
 *
 * The manager is pure, so the tests need no provider. The integration
 * test uses a scripted model that records every prompt it receives; it
 * proves that only the bounded copy is sent, while the full history of
 * the run is kept and the system rules and the task never change.
 */
import { describe, expect, it } from 'vitest';
import { AgentLoop } from '../../apps/desktop/src/main/agent/agentLoop';
import {
  compactContext,
  contextBudgetFor,
  DEFAULT_CONTEXT_BUDGET,
  LOCAL_CONTEXT_BUDGET,
  type ContextBudget,
} from '../../apps/desktop/src/main/agent/contextManager';
import { ToolRegistry } from '../../apps/desktop/src/main/agent/tools';
import type { ChatMessage } from '../../apps/desktop/src/shared/ai-types';
import type {
  AgentEvent,
  AgentLimits,
} from '../../apps/desktop/src/shared/agent-types';

const LIMITS: AgentLimits = {
  maxSteps: 5,
  maxDurationMs: 60_000,
  maxCharacters: 20_000,
  maxConsecutiveFailures: 3,
};

const SMALL_BUDGET: ContextBudget = {
  maxTotalCharacters: 12_000,
  maxRecentMessageCharacters: 800,
  maxOldMessageCharacters: 200,
  keepRecentMessages: 2,
};

function conversation(): ChatMessage[] {
  return [
    { role: 'system', content: 'THE SAFETY RULES' },
    { role: 'user', content: 'THE TASK' },
    ...Array.from({ length: 10 }, (_value, index) => ({
      role: 'user' as const,
      content: `result-${index}: ${'x'.repeat(4_000)}`,
    })),
  ];
}

function totalLength(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function fakeContext() {
  return {
    runId: 'run-context',
    root: 'C:\\work',
    signal: new AbortController().signal,
    settings: { allowedLevels: ['read'], allowCloudContext: false },
    requestApproval: async () => true,
    createProposal: () => {
      throw new Error('not used');
    },
    commands: [],
    inspected: [],
  };
}

/** Builds a loop whose model records each prompt and handles many steps. */
function buildRecordingLoop(
  toolResult: string,
  options: {
    budget?: ContextBudget;
    limits?: AgentLimits;
  } = {},
) {
  const prompts: ChatMessage[][] = [];
  const events: AgentEvent[] = [];
  let step = 0;
  const loop = new AgentLoop({
    task: 'THE TASK',
    systemPrompt: 'THE SAFETY RULES',
    limits: options.limits ?? LIMITS,
    registry: new ToolRegistry(),
    executor: {
      execute: async () => ({ ok: true, content: toolResult }),
    } as never,
    context: fakeContext() as never,
    callModel: async (_requestId, messages) => {
      prompts.push(messages.map((message) => ({ ...message })));
      step += 1;
      return step < 4
        ? {
            text: `{"thought":"read","tool":{"name":"read_file","arguments":{"path":"f${step}.ts"}}}`,
            toolCall: null,
          }
        : { text: '{"thought":"done","final":"finished"}', toolCall: null };
    },
    onEvent: (event) => {
      events.push(event);
    },
    proposals: { list: () => [] },
    contextBudget: options.budget,
  });
  return { loop, prompts, events };
}

describe('the context manager', () => {
  it('keeps the safety rules and the task byte for byte', () => {
    const messages = conversation();
    const compacted = compactContext(messages, SMALL_BUDGET);
    expect(compacted.messages[0]).toEqual(messages[0]);
    expect(compacted.messages[1]).toEqual(messages[1]);
  });

  it('bounds the prompt and shortens the oldest results first', () => {
    const messages = conversation();
    const compacted = compactContext(messages, SMALL_BUDGET);
    expect(totalLength(compacted.messages)).toBeLessThanOrEqual(
      SMALL_BUDGET.maxTotalCharacters,
    );
    expect(compacted.shortened + compacted.omitted).toBeGreaterThan(0);
    expect(compacted.notice).not.toBeNull();
    expect(compacted.notice).toContain('safety rules');
  });

  it('keeps the newest result and shortens an older one', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'task' },
      { role: 'user', content: `old: ${'o'.repeat(2_000)}` },
      { role: 'user', content: `new: ${'n'.repeat(1_000)}` },
    ];
    const compacted = compactContext(messages, {
      maxTotalCharacters: 5_000,
      maxRecentMessageCharacters: 1_200,
      maxOldMessageCharacters: 100,
      keepRecentMessages: 1,
    });
    const joined = compacted.messages.map((message) => message.content).join('\n');
    expect(joined).toContain('new: ');
    expect(joined).not.toContain('o'.repeat(200));
    expect(compacted.shortened).toBe(1);
  });

  it('is safe with a budget that is smaller than the protected messages', () => {
    const compacted = compactContext(conversation(), {
      maxTotalCharacters: 100,
      maxRecentMessageCharacters: 50,
      maxOldMessageCharacters: 20,
      keepRecentMessages: 1,
    });
    expect(compacted.messages[0]?.content).toBe('THE SAFETY RULES');
    expect(compacted.messages[1]?.content).toBe('THE TASK');
    expect(compacted.omitted).toBe(10);
    expect(compacted.notice).not.toBeNull();
  });

  it('does not change a conversation that already fits', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'task' },
      { role: 'user', content: 'small result' },
    ];
    const compacted = compactContext(messages, DEFAULT_CONTEXT_BUDGET);
    expect(compacted.messages).toEqual(messages);
    expect(compacted.notice).toBeNull();
    expect(compacted.shortened).toBe(0);
    expect(compacted.omitted).toBe(0);
  });

  it('uses a smaller budget for a local model', () => {
    expect(LOCAL_CONTEXT_BUDGET.maxTotalCharacters).toBeLessThan(
      DEFAULT_CONTEXT_BUDGET.maxTotalCharacters,
    );
    expect(contextBudgetFor('local', 'llama3')).toBe(LOCAL_CONTEXT_BUDGET);
    expect(contextBudgetFor('cloud', 'gpt-4.1')).toBe(DEFAULT_CONTEXT_BUDGET);
  });
});

describe('the agent loop with a bounded context', () => {
  it('sends only the bounded copy and reports a visible notice', async () => {
    const { loop, prompts, events } = buildRecordingLoop('r'.repeat(4_000), {
      budget: SMALL_BUDGET,
    });
    const result = await loop.run(new AbortController().signal);
    expect(result.summary.state).toBe('completed');

    // Every prompt starts with the unchanged rules and task.
    for (const prompt of prompts) {
      expect(prompt[0]).toEqual({ role: 'system', content: 'THE SAFETY RULES' });
      expect(prompt[1]).toEqual({ role: 'user', content: 'THE TASK' });
      expect(totalLength(prompt)).toBeLessThanOrEqual(
        SMALL_BUDGET.maxTotalCharacters,
      );
    }

    // The full history is still in the loop: later prompts contain the
    // recent results, and the summary reports the notices.
    const last = prompts[prompts.length - 1] ?? [];
    expect(last.length).toBeGreaterThan(2);
    expect(result.summary.contextNotices?.length).toBeGreaterThan(0);
    expect(
      events.some((event) => event.type === 'context-compacted'),
    ).toBe(true);
    expect(result.summary.errors).toHaveLength(0);
  });

  it('lets the run limit lower the budget but never raise it', async () => {
    const { loop, prompts } = buildRecordingLoop('r'.repeat(1_000), {
      budget: SMALL_BUDGET,
      limits: { ...LIMITS, maxPromptCharacters: 500 },
    });
    const result = await loop.run(new AbortController().signal);
    expect(result.summary.state).toBe('completed');
    for (const prompt of prompts) {
      expect(totalLength(prompt)).toBeLessThanOrEqual(500);
    }

    // A larger limit cannot widen the provider budget.
    const { loop: wide, prompts: widePrompts } = buildRecordingLoop(
      'r'.repeat(1_000),
      {
        budget: SMALL_BUDGET,
        limits: { ...LIMITS, maxPromptCharacters: 999_999 },
      },
    );
    await wide.run(new AbortController().signal);
    for (const prompt of widePrompts) {
      expect(totalLength(prompt)).toBeLessThanOrEqual(
        SMALL_BUDGET.maxTotalCharacters,
      );
    }
  });
});
