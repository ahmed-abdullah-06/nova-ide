/**
 * Tokenized dirty-confirmation handshake for window close and app quit.
 *
 * The main process owns the decision: it sends a random token to the renderer,
 * which may only answer that token. An answer that never arrives (renderer
 * busy or unresponsive) cancels the close, so unsaved work is never dropped.
 * This module has no Electron runtime dependency and is unit-testable.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { CloseRequest, CloseRequestReason } from '../shared/ipc-types';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface CloseFlowOptions {
  /** Sends the request to the renderer (main process chooses the target). */
  sendRequest: (request: CloseRequest) => void;
  /** Called once when the renderer explicitly confirms the request. */
  onConfirmed: (reason: CloseRequestReason, window: BrowserWindow | null) => void;
  /** How long to wait before cancelling the close. */
  timeoutMs?: number;
}

interface PendingClose {
  reason: CloseRequestReason;
  window: BrowserWindow | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (confirmed: boolean) => void;
}

export class CloseFlow {
  private readonly pending = new Map<string, PendingClose>();
  private readonly timeoutMs: number;

  constructor(private readonly options: CloseFlowOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True while the renderer is still answering a close request. */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Asks the renderer to confirm a close. Only one request may be outstanding,
   * so two native close clicks cannot produce two contradictory dialogs.
   */
  request(
    reason: CloseRequestReason,
    window: BrowserWindow | null = null,
  ): Promise<boolean> {
    if (this.pending.size > 0) {
      return Promise.resolve(false);
    }
    const token = randomUUID();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        resolve(false);
      }, this.timeoutMs);
      // A pending dialog must not keep a test process alive.
      const unref = (timer as { unref?: () => void }).unref;
      if (typeof unref === 'function') {
        unref.call(timer);
      }
      this.pending.set(token, { reason, window, timer, resolve });
      this.options.sendRequest({ token, reason });
    });
  }

  /**
   * Answers an outstanding request. Returns false for an unknown or already
   * answered token; no close happens in that case.
   */
  confirm(token: string, confirmed: boolean): boolean {
    const pending = this.pending.get(token);
    if (pending === undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pending.delete(token);
    pending.resolve(confirmed);
    if (confirmed) {
      this.options.onConfirmed(pending.reason, pending.window);
    }
    return true;
  }

  /** Cancels every outstanding request without closing anything. */
  dispose(): void {
    for (const [token, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(token);
      pending.resolve(false);
    }
  }
}
