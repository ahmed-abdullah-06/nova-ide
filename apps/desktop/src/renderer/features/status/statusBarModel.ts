/**
 * Pure view models for the status bar (LF3).
 *
 * Kept free of React and IPC so the formatting rules can be unit tested. The
 * data itself is real: git status comes from the shared `useGit` controller,
 * problem counts from diagnostics, and the EOL from the active buffer.
 */
import type { GitStatus } from '../../../shared/ipc-types';

export type NotificationKind = 'info' | 'warning' | 'error';

/** Structural type so this model does not depend on the workspace store. */
export interface NotificationLike {
  id: number;
  kind: NotificationKind;
  message: string;
}

export interface GitStatusSummary {
  branch: string;
  changeCount: number;
  tooltip: string;
}

/**
 * Summarises a git status for the status bar. Returns null when there is no
 * repository (or no branch yet), so the UI never invents a branch name.
 */
export function summarizeGitStatus(
  status: GitStatus | null,
): GitStatusSummary | null {
  if (status === null || !status.isRepository || status.branch === null) {
    return null;
  }
  const staged = status.staged.length;
  const unstaged = status.unstaged.length;
  const untracked = status.untracked.length;
  const changeCount = staged + unstaged + untracked;
  const parts = [`${status.branch}`];
  if (status.upstream !== null) {
    parts.push(`upstream ${status.upstream}`);
  }
  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`);
  }
  if (status.behind > 0) {
    parts.push(`${status.behind} behind`);
  }
  parts.push(
    changeCount === 0
      ? 'No changes'
      : `${changeCount} changed file(s): ${staged} staged, ${unstaged} unstaged, ${untracked} untracked`,
  );
  return { branch: status.branch, changeCount, tooltip: parts.join(' · ') };
}

/** Ln/Col label for the active buffer. */
export function formatCursor(line: number, column: number): string {
  return `Ln ${Math.max(1, line)}, Col ${Math.max(1, column)}`;
}

/** Indentation label derived from the editor's configured tab size. */
export function formatIndentation(tabSize: number): string {
  return `Spaces: ${Math.max(1, Math.trunc(tabSize))}`;
}

export type Eol = 'LF' | 'CRLF';

/** Detects the line ending actually present in the active buffer. */
export function detectEol(content: string): Eol {
  return content.includes('\r\n') ? 'CRLF' : 'LF';
}

/**
 * Problems label. Returns null when there is nothing to report so the status
 * bar does not show a permanent zero badge.
 */
export function formatProblemCounts(
  errors: number,
  warnings: number,
): string | null {
  if (errors <= 0 && warnings <= 0) {
    return null;
  }
  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  }
  if (warnings > 0) {
    parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

/**
 * Newest-first, bounded notification history for the status-bar bell. The
 * on-screen toasts auto-dismiss; this history deliberately retains them.
 */
export function selectNotificationHistory(
  notifications: readonly NotificationLike[],
  limit = 20,
): readonly NotificationLike[] {
  const size = Math.max(0, Math.trunc(limit));
  if (size === 0) {
    return [];
  }
  return notifications.slice(-size).reverse();
}
