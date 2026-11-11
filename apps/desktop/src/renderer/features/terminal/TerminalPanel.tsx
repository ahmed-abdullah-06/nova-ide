/**
 * Terminal panel of the bottom area (spec §6.1, §17).
 *
 * Shows every terminal session as a tab, hosts one xterm.js view per
 * session and offers the session actions (new, close, copy, paste).
 */
import { useCallback, useRef, useState } from 'react';
import { TerminalView } from './TerminalView';
import { useTerminalSessions } from './useTerminalSessions';

export interface TerminalPanelProps {
  /** True when a workspace is open (a terminal needs one). */
  hasWorkspace: boolean;
}

export function TerminalPanel({
  hasWorkspace,
}: TerminalPanelProps): React.JSX.Element {
  const controller = useTerminalSessions(hasWorkspace);
  const [error, setError] = useState<string | null>(null);
  const viewHostRef = useRef<HTMLDivElement | null>(null);

  const handleCreate = useCallback(async (): Promise<void> => {
    const id = await controller.createSession();
    if (id === null) {
      setError('The terminal could not be started.');
    }
  }, [controller]);

  /** Copies the selection of the active terminal to the clipboard. */
  const handleCopy = useCallback((): void => {
    const selection = window.getSelection()?.toString() ?? '';
    if (selection.length > 0) {
      void navigator.clipboard.writeText(selection);
    }
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-panel__toolbar">
        <div
          className="terminal-panel__tabs"
          role="tablist"
          aria-label="Terminal sessions"
        >
          {controller.sessions.map((entry) => (
            <span
              key={entry.session.id}
              className={`terminal-panel__tab${
                entry.session.id === controller.activeSessionId
                  ? ' terminal-panel__tab--active'
                  : ''
              }`}
              role="tab"
              aria-selected={entry.session.id === controller.activeSessionId}
            >
              <button
                type="button"
                className="terminal-panel__tab-label"
                onClick={() => controller.selectSession(entry.session.id)}
                title={`${entry.session.shell} — ${entry.session.cwd}`}
              >
                {entry.session.shell}
                {entry.exited ? ' (exited)' : ''}
              </button>
              <button
                type="button"
                className="terminal-panel__tab-close"
                aria-label="Close terminal session"
                onClick={() => controller.closeSession(entry.session.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="terminal-panel__actions">
          <button
            type="button"
            className="terminal-panel__action"
            onClick={() => void handleCreate()}
            title="New terminal session"
          >
            +
          </button>
          <button
            type="button"
            className="terminal-panel__action"
            onClick={handleCopy}
            title="Copy the selection"
          >
            Copy
          </button>
        </div>
      </div>

      {error !== null ? (
        <p className="terminal-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="terminal-panel__views" ref={viewHostRef}>
        {controller.sessions.map((entry) => (
          <div
            key={entry.session.id}
            className="terminal-panel__view"
            hidden={entry.session.id !== controller.activeSessionId}
          >
            <TerminalView
              sessionId={entry.session.id}
              active={entry.session.id === controller.activeSessionId}
              onInput={controller.write}
              onResize={controller.resize}
              subscribeOutput={controller.subscribeOutput}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
