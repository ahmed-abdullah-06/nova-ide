/**
 * Dirty-confirmation handshake tests.
 *
 * The handshake never trusts a renderer-supplied target: only a token issued
 * by the main process can approve a close, and an unanswered request cancels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloseFlow } from '../../apps/desktop/src/main/closeFlow';
import type { CloseRequest, CloseRequestReason } from '../../apps/desktop/src/shared/ipc-types';

interface Harness {
  flow: CloseFlow;
  sent: CloseRequest[];
  confirmed: CloseRequestReason[];
}

function makeFlow(timeoutMs = 30_000): Harness {
  const sent: CloseRequest[] = [];
  const confirmed: CloseRequestReason[] = [];
  const flow = new CloseFlow({
    timeoutMs,
    sendRequest: (request) => sent.push(request),
    onConfirmed: (reason) => confirmed.push(reason),
  });
  return { flow, sent, confirmed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CloseFlow', () => {
  it('sends a token and only closes when that token is confirmed', async () => {
    const { flow, sent, confirmed } = makeFlow();
    const pending = flow.request('quit');
    expect(flow.hasPending).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.reason).toBe('quit');
    expect(sent[0]!.token.length).toBeGreaterThan(8);

    expect(flow.confirm(sent[0]!.token, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(confirmed).toEqual(['quit']);
    expect(flow.hasPending).toBe(false);
  });

  it('cancels the close when the renderer declines', async () => {
    const { flow, sent, confirmed } = makeFlow();
    const pending = flow.request('close-window');
    expect(flow.confirm(sent[0]!.token, false)).toBe(true);
    await expect(pending).resolves.toBe(false);
    expect(confirmed).toEqual([]);
  });

  it('rejects unknown and replayed tokens', async () => {
    const { flow, sent, confirmed } = makeFlow();
    const pending = flow.request('close-window');
    expect(flow.confirm('forged-token', true)).toBe(false);
    expect(flow.confirm(sent[0]!.token, true)).toBe(true);
    expect(flow.confirm(sent[0]!.token, true)).toBe(false);
    await expect(pending).resolves.toBe(true);
    expect(confirmed).toHaveLength(1);
  });

  it('allows only one outstanding request', async () => {
    const { flow, sent } = makeFlow();
    const first = flow.request('quit');
    await expect(flow.request('quit')).resolves.toBe(false);
    expect(sent).toHaveLength(1);
    flow.confirm(sent[0]!.token, true);
    await expect(first).resolves.toBe(true);
  });

  it('cancels on timeout so an unresponsive renderer never loses work', async () => {
    vi.useFakeTimers();
    const { flow, confirmed } = makeFlow(1_000);
    const pending = flow.request('close-window');
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toBe(false);
    expect(confirmed).toEqual([]);
    expect(flow.hasPending).toBe(false);
  });

  it('dispose cancels outstanding requests', async () => {
    const { flow, confirmed } = makeFlow();
    const pending = flow.request('quit');
    flow.dispose();
    await expect(pending).resolves.toBe(false);
    expect(confirmed).toEqual([]);
    expect(flow.hasPending).toBe(false);
  });
});
