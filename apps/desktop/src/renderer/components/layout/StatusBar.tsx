import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/icons';
import type { Theme } from '../../hooks/useTheme';
import { LANGUAGES } from '../../utils/language';
import {
  formatCursor,
  formatProblemCounts,
  selectNotificationHistory,
  type Eol,
  type GitStatusSummary,
  type NotificationLike,
} from '../../features/status/statusBarModel';

interface CursorPosition {
  line: number;
  column: number;
}

interface StatusBarProps {
  language: string | null;
  onLanguageChange: (language: string) => void;
  cursor: CursorPosition;
  theme: Theme;
  onToggleTheme: () => void;
  /** Display name of the active workspace (null when no folder is open). */
  workspaceName: string | null;
  /** Canonical root of the active workspace (for the tooltip). */
  workspaceRoot: string | null;
  /** Real local-only state from the shared AI controller. */
  localOnly: boolean;
  /** Real git branch/change summary; null when no repository is open. */
  gitSummary: GitStatusSummary | null;
  /** Diagnostics of the open files. */
  errorCount: number;
  warningCount: number;
  /** Indentation label derived from the editor tab size. */
  indentation: string;
  /** Line ending detected in the active buffer. */
  eol: Eol;
  /** False for the Settings tab, which has no text-buffer context. */
  hasBuffer: boolean;
  /** Bounded notification history retained after toasts auto-dismiss. */
  notifications: readonly NotificationLike[];
}

/**
 * Status bar (spec §6.1). Only the language picker, theme switch and bell
 * are interactive; every other value is a plain span with a non-interactive
 * appearance so no decoration pretends to be a control.
 */
export function StatusBar({
  language,
  onLanguageChange,
  cursor,
  theme,
  onToggleTheme,
  workspaceName,
  workspaceRoot,
  localOnly,
  gitSummary,
  errorCount,
  warningCount,
  indentation,
  eol,
  hasBuffer,
  notifications,
}: StatusBarProps): ReactNode {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const history = selectNotificationHistory(notifications);
  const problems = formatProblemCounts(errorCount, warningCount);

  useEffect(() => {
    if (!bellOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setBellOpen(false);
      }
    };
    const handlePointer = (event: MouseEvent): void => {
      if (bellRef.current !== null && !bellRef.current.contains(event.target as Node)) {
        setBellOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handlePointer);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handlePointer);
    };
  }, [bellOpen]);

  return (
    <footer className="status-bar" aria-label="Status bar">
      <span
        className="status-bar__item"
        title={workspaceRoot ?? 'No folder open'}
      >
        {workspaceName ?? 'No folder open'}
      </span>

      {gitSummary !== null ? (
        <span className="status-bar__item" title={gitSummary.tooltip}>
          <Icon name="branch" size={13} />
          {gitSummary.branch}
          {gitSummary.changeCount > 0 ? (
            <span className="status-bar__change-count">
              <Icon name="gitChange" size={12} />
              {gitSummary.changeCount}
            </span>
          ) : null}
        </span>
      ) : null}

      {problems !== null ? (
        <span
          className="status-bar__item"
          title="Diagnostics in the open files"
        >
          {errorCount > 0 ? <Icon name="error" size={13} /> : null}
          {warningCount > 0 ? <Icon name="warning" size={13} /> : null}
          {problems}
        </span>
      ) : null}

      <span
        className={`status-bar__privacy${localOnly ? ' status-bar__privacy--on' : ''}`}
        role="status"
        title={
          localOnly
            ? 'Local-only mode is on: cloud providers and cloud voice are blocked by the main process'
            : 'Local-only mode is off: cloud providers may be used'
        }
      >
        <Icon name="shield" size={13} />
        {localOnly ? 'Local-only: on' : 'Local-only: off'}
      </span>

      <span className="status-bar__spacer" />

      {hasBuffer ? (
        <>
          <span className="status-bar__item" title="Cursor position">
            {formatCursor(cursor.line, cursor.column)}
          </span>
          <span className="status-bar__item" title="Indentation">
            <Icon name="indent" size={13} />
            {indentation}
          </span>
          <span className="status-bar__item" title="Buffer encoding">
            <Icon name="encoding" size={13} />
            UTF-8
          </span>
          <span className="status-bar__item" title="Line ending">
            <Icon name="eol" size={13} />
            {eol}
          </span>
        </>
      ) : null}

      <span className="status-bar__item" title="Language of the active buffer">
        <select
          aria-label="Language of the active buffer"
          value={language ?? 'plaintext'}
          disabled={language === null}
          onChange={(event) => onLanguageChange(event.target.value)}
          style={{
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            font: 'inherit',
            cursor: language === null ? 'not-allowed' : 'pointer',
          }}
        >
          {LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </span>

      <div className="status-bar__bell" ref={bellRef}>
        <button
          type="button"
          className="status-bar__item status-bar__bell-button"
          onClick={() => setBellOpen((open) => !open)}
          title="Notifications"
          aria-label="Notifications"
          aria-expanded={bellOpen}
        >
          <Icon name="bell" size={13} />
          {history.length > 0 ? (
            <span className="status-bar__bell-count">{history.length}</span>
          ) : null}
        </button>
        {bellOpen ? (
          <div className="status-bar__bell-popover" role="log" aria-label="Notification history">
            <div className="status-bar__bell-title">Notifications</div>
            {history.length === 0 ? (
              <p className="status-bar__bell-empty">No notifications yet.</p>
            ) : (
              <ul>
                {history.map((entry) => (
                  <li key={entry.id} className={`status-bar__bell-entry status-bar__bell-entry--${entry.kind}`}>
                    <Icon
                      name={entry.kind === 'error' ? 'error' : entry.kind === 'warning' ? 'warning' : 'info'}
                      size={13}
                    />
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="status-bar__item"
        onClick={onToggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? '☾ Dark' : '☀ Light'}
      </button>
    </footer>
  );
}
