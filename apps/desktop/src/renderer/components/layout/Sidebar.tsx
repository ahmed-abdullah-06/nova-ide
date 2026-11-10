import type { ReactNode } from 'react';
import type { ActivityId } from './ActivityBar';
import { PlaceholderView } from './PlaceholderView';
import type { Theme } from '../../hooks/useTheme';
import { Explorer } from '../../features/explorer/components/Explorer';

interface SidebarProps {
  activity: ActivityId;
  theme: Theme;
  onToggleTheme: () => void;
  /** Bumped by Ctrl+Shift+E to focus the explorer tree. */
  focusSignal: number;
}

function bodyFor(activity: ActivityId, theme: Theme, onToggleTheme: () => void): ReactNode {
  switch (activity) {
    case 'search':
      return (
        <PlaceholderView
          title="Search"
          note="Search across every file in the open workspace with filters and replace."
          milestone="Milestone 3"
        />
      );
    case 'scm':
      return (
        <PlaceholderView
          title="Source Control"
          note="Inspect Git status and diffs, stage changes, and commit from NOVA IDE."
          milestone="Milestone 3"
        />
      );
    case 'agent':
      return (
        <PlaceholderView
          title="AI Agent"
          note="Chat with local and cloud models, then let the agent plan and execute approved workspace tasks."
          milestone="Milestones 4–6"
        />
      );
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

export function Sidebar({
  activity,
  theme,
  onToggleTheme,
  focusSignal,
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
      {bodyFor(activity, theme, onToggleTheme)}
    </aside>
  );
}
