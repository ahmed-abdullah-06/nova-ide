import type { ReactNode } from 'react';
import type { ActivityId } from './ActivityBar';
import { PlaceholderView } from './PlaceholderView';
import type { Theme } from '../../hooks/useTheme';
import { Explorer } from '../../features/explorer/components/Explorer';
import { SearchView } from '../../features/search/SearchView';
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
}

function bodyFor(
  activity: ActivityId,
  theme: Theme,
  onToggleTheme: () => void,
  hasWorkspace: boolean,
  onOpenSearchResult: (match: SearchMatch) => void,
): ReactNode {
  switch (activity) {
    case 'search':
      return (
        <SearchView
          hasWorkspace={hasWorkspace}
          onOpenResult={onOpenSearchResult}
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
  hasWorkspace,
  onOpenSearchResult,
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
      {bodyFor(activity, theme, onToggleTheme, hasWorkspace, onOpenSearchResult)}
    </aside>
  );
}
