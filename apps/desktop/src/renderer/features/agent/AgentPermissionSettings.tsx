/**
 * The permission settings of the agent (spec §12.3, §18.8).
 *
 * The panel shows the three categories the user can change and the
 * defaults next to them. Narrowing a permission is applied at once; a
 * widening is confirmed by a native dialog of the main process — the
 * renderer cannot widen the policy itself.
 *
 * The forbidden operations of the tool registry stay impossible: they
 * are not a category and there is no setting for them.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AgentPermissionCategory,
  AgentPermissionView,
} from '../../../shared/agent-types';

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
    detail: 'Write or edit a file — every change still needs your acceptance.',
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

export function AgentPermissionSettings(): React.JSX.Element {
  const [view, setView] = useState<AgentPermissionView | null>(null);
  const [busy, setBusy] = useState<AgentPermissionCategory | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api) {
      return;
    }
    setView(await api.agent.permissionSettings());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    [view],
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
      </p>
      {view === null ? (
        <p className="agent-panel__permissions-loading">Loading…</p>
      ) : (
        <ul className="agent-panel__permissions-list">
          {CATEGORIES.map((category) => {
            const { label, detail } = CATEGORY_LABELS[category];
            const allowed = view.current[category];
            const byDefault = view.defaults[category];
            return (
              <li key={category} className="agent-panel__permission">
                <label className="agent-panel__permission-label">
                  <input
                    type="checkbox"
                    checked={allowed}
                    disabled={busy !== null}
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
