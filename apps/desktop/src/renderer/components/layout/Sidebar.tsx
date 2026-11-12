import type { ReactNode } from 'react';
import type { ActivityId } from './ActivityBar';
import type { Theme } from '../../hooks/useTheme';
import { Explorer } from '../../features/explorer/components/Explorer';
import { SearchView } from '../../features/search/SearchView';
import { SourceControlView } from '../../features/git/SourceControlView';
import { useAgent } from '../../features/agent/useAgent';
import type { SearchMatch } from '../../../shared/ipc-types';

interface SidebarProps {
  activity: ActivityId;
  theme: Theme;
  onToggleTheme: () => void;
  /** Bumped by Ctrl+Shift+E to focus the explorer tree. */
  focusSignal: number;
  /** True when a workspace is open. */
  hasWorkspace: boolean;
  /** Opens a search result in the editor. */
  onOpenSearchResult: (match: SearchMatch) => void;
  /** Opens a file of the workspace in the editor. */
  onOpenFile: (path: string) => void;
}

function bodyFor(
  activity: ActivityId,
  theme: Theme,
  onToggleTheme: () => void,
  hasWorkspace: boolean,
  onOpenSearchResult: (match: SearchMatch) => void,
  onOpenFile: (path: string) => void,
): ReactNode {
  switch (activity) {
    case 'search':
      return (
        <SearchView
          hasWorkspace={hasWorkspace}
          onOpenResult={onOpenSearchResult}
        />
      );
    case 'scm':
      return (
        <SourceControlView
          hasWorkspace={hasWorkspace}
          onOpenFile={onOpenFile}
        />
      );
    case 'agent':
      return <AgentRuns />;
    case 'settings':
      return (
        <div className="sidebar__section">
          <div className="sidebar__header" style={{ padding: '8px 0' }}>
            Appearance
          </div>
          <button
            type="button"
            className="sidebar__row"
            onClick={onToggleTheme}
            aria-pressed={theme === 'light'}
          >
            Theme: {theme === 'dark' ? 'Dark' : 'Light'} (click to switch)
          </button>
          <p className="placeholder-view__note" style={{ textAlign: 'left' }}>
            Only settings with working functionality are shown. Editor, AI,
            terminal, and privacy settings arrive with their milestones.
          </p>
        </div>
      );
    case 'extensions':
      return null;
    default:
      return null;
  }
}

const TITLES: Record<ActivityId, string> = {
  explorer: 'Explorer',
  search: 'Search',
  scm: 'Source Control',
  agent: 'AI Agent',
  extensions: 'Extensions',
  settings: 'Settings',
};

/**
 * The runs of the coding agent (spec §6.1).
 *
 * The panel of the AI assistant shows the details; the sidebar shows the
 * state of the current run.
 */
function AgentRuns(): ReactNode {
  const agent = useAgent();
  const state = agent.state;
  return (
    <div className="sidebar__section">
      <div className="sidebar__header">AI Agent</div>
      {state.state === 'idle' ? (
        <p className="placeholder-view__note" style={{ textAlign: 'left' }}>
          No run yet. Open the agent in the AI assistant and describe what
          should be done.
        </p>
      ) : (
        <>
          <p className="placeholder-view__note" style={{ textAlign: 'left' }}>
            {state.state}
            {state.kind === 'cloud' ? ' · CLOUD' : ' · LOCAL'}
          </p>
          {state.task.length > 0 ? (
            <p className="placeholder-view__note" style={{ textAlign: 'left' }}>
              {state.task}
            </p>
          ) : null}
          <ul className="sidebar__list">
            {state.events.slice(-8).map((event) => (
              <li key={`${event.step}-${event.at}`} className="sidebar__row">
                {event.summary}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Sidebar({
  activity,
  theme,
  onToggleTheme,
  focusSignal,
  hasWorkspace,
  onOpenSearchResult,
  onOpenFile,
}: SidebarProps): ReactNode {
  // The explorer renders its own header (title + refresh/close actions).
  if (activity === 'explorer') {
    return (
      <aside className="sidebar" aria-label="Explorer sidebar">
        <Explorer focusSignal={focusSignal} />
      </aside>
    );
  }
  return (
    <aside className="sidebar" aria-label={`${TITLES[activity]} sidebar`}>
      <div className="sidebar__header">{TITLES[activity]}</div>
      {bodyFor(
        activity,
        theme,
        onToggleTheme,
        hasWorkspace,
        onOpenSearchResult,
        onOpenFile,
      )}
    </aside>
  );
}
