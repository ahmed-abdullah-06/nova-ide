/**
 * Shared view of the agent permissions (LF8-1).
 *
 * The main process owns the policy. This context only keeps one renderer-wide
 * copy of the view so the status bar, the Settings page and the shield
 * popover cannot disagree about the session-only Allow-all switch.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AgentPermissionView } from '../../../shared/agent-types';

export interface AgentPermissionsContextValue {
  /** The current view, or null while it loads. */
  view: AgentPermissionView | null;
  /** Replaces the view after a confirmed change. */
  setView: (view: AgentPermissionView) => void;
  /** Re-reads the view from the main process. */
  reload: () => Promise<void>;
}

const AgentPermissionsContext =
  createContext<AgentPermissionsContextValue | null>(null);

export function AgentPermissionsProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [view, setView] = useState<AgentPermissionView | null>(null);

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

  const value = useMemo<AgentPermissionsContextValue>(
    () => ({ view, setView, reload }),
    [reload, view],
  );

  return (
    <AgentPermissionsContext.Provider value={value}>
      {children}
    </AgentPermissionsContext.Provider>
  );
}

export function useAgentPermissions(): AgentPermissionsContextValue {
  const context = useContext(AgentPermissionsContext);
  if (context === null) {
    throw new Error('useAgentPermissions must be used inside AgentPermissionsProvider');
  }
  return context;
}
