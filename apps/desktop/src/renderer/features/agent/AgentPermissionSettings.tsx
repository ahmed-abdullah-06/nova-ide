/**
 * The permission settings of the agent (spec §12.3, §18.8, LF8-1).
 *
 * The panel shows the session-wide master switch and the three categories
 * the user can change, next to their defaults. Narrowing a permission is
 * applied at once; widening and enabling Allow all are confirmed by a
 * native dialog of the main process — the renderer cannot widen the policy
 * itself or pass a "confirmed" flag.
 *
 * The forbidden operations of the tool registry stay impossible: they are
 * not a category and there is no setting for them.
 */
import { useCallback, useState } from 'react';
import type { AgentPermissionCategory } from '../../../shared/agent-types';
import { Toggle } from '../../components/ui';
import { useAgentPermissions } from './AgentPermissionContext';

/** What each category covers. */
const CATEGORY_LABELS: Record<
  AgentPermissionCategory,
  { label: string; detail: string }
> = {
  read: {
    label: 'Read the workspace',
    detail: 'Read files, search, list folders and inspect Git.',
  },
  workspace: {
    label: 'Prepare file changes',
    detail:
      'Write or edit a file — every change still needs your acceptance unless Allow all is on.',
  },
  command: {
    label: 'Run commands',
    detail: 'Run the scripts of the workspace or a command as an argument list.',
  },
};

const CATEGORIES: readonly AgentPermissionCategory[] = [
  'read',
  'workspace',
  'command',
];

type Busy = 'allow-all' | AgentPermissionCategory | null;

export function AgentPermissionSettings(): React.JSX.Element {
  const { view, setView } = useAgentPermissions();
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAllowAll = useCallback(
    async (enabled: boolean): Promise<void> => {
      const api = window.nova;
      if (!api) {
        return;
      }
      setBusy('allow-all');
      setError(null);
      setMessage(null);
      const result = await api.agent.setAllowAll(enabled);
      setBusy(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setView(result.value);
      setMessage(
        enabled
          ? 'Allow all is on for this session. It resets when the application restarts.'
          : 'Allow all is off. Every change asks for your approval again.',
      );
    },
    [setView],
  );

  const handleToggle = useCallback(
    async (category: AgentPermissionCategory): Promise<void> => {
      const api = window.nova;
      if (!api || view === null) {
        return;
      }
      const next = !view.current[category];
      setBusy(category);
      setError(null);
      setMessage(null);
      const result = await api.agent.updatePermission(category, next);
      setBusy(null);
      if (!result.ok) {
        // The user declined the native confirmation; nothing changed.
        setError(result.message);
        return;
      }
      setView(result.value);
      setMessage(
        next
          ? `${CATEGORY_LABELS[category].label} is now allowed without asking.`
          : `${CATEGORY_LABELS[category].label} now asks for your approval.`,
      );
    },
    [setView, view],
  );

  return (
    <section
      className="agent-panel__permissions"
      aria-label="Agent permissions"
    >
      <h4 className="agent-panel__permissions-title">Permissions</h4>
      <p className="agent-panel__permissions-note">
        Forbidden operations (delete, install, git commit/push, shells and
        anything outside the workspace) stay blocked whatever you choose.
        Local-only and the privacy gate are unchanged.
      </p>
      {view === null ? (
        <p className="agent-panel__permissions-loading">Loading…</p>
      ) : (
        <>
          <Toggle
            checked={view.allowAll}
            label="Allow all (auto-approve)"
            description="Allow reading, file changes and commands for this session only; resets on restart."
            disabled={busy !== null}
            onChange={(checked) => void handleAllowAll(checked)}
          />
          <p
            className={`agent-panel__permissions-allow-all-note${
              view.allowAll ? ' agent-panel__permissions-allow-all-note--on' : ''
            }`}
            role={view.allowAll ? 'status' : undefined}
          >
            {view.allowAll
              ? 'Allow all is on. File changes are applied automatically, but they still create a checkpoint and remain revertible. Path containment, forbidden operations, privacy and Local-only stay enforced.'
              : 'Off by default. Turning it on asks for confirmation in a main-process dialog.'}
          </p>
          <ul className="agent-panel__permissions-list">
            {CATEGORIES.map((category) => {
              const { label, detail } = CATEGORY_LABELS[category];
              const allowed = view.current[category] || view.allowAll;
              const byDefault = view.defaults[category];
              return (
                <li key={category} className="agent-panel__permission">
                  <label className="agent-panel__permission-label">
                    <input
                      type="checkbox"
                      checked={allowed}
                      disabled={busy !== null || view.allowAll}
                      onChange={() => void handleToggle(category)}
                    />
                    <span className="agent-panel__permission-text">
                      <span className="agent-panel__permission-name">{label}</span>
                      <span className="agent-panel__permission-detail">
                        {detail}
                      </span>
                      <span className="agent-panel__permission-default">
                        {byDefault
                          ? 'Default: allowed without asking'
                          : 'Default: asks for your approval'}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {message !== null ? (
        <p className="agent-panel__permission-message" role="status">
          {message}
        </p>
      ) : null}
      {error !== null ? (
        <p className="agent-panel__permission-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
