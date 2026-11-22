import type { ReactNode } from 'react';
import type { ActivityId } from './ActivityBar';
import { Explorer } from '../../features/explorer/components/Explorer';
import { SearchView } from '../../features/search/SearchView';
import { SourceControlView } from '../../features/git/SourceControlView';
import type { SearchMatch } from '../../../shared/ipc-types';

interface SidebarProps {
  activity: ActivityId;
  /** Bumped by Ctrl+Shift+E to focus the explorer tree. */
  focusSignal: number;
  /** True when a workspace is open. */
  hasWorkspace: boolean;
  /** Opens a search result in the editor. */
  onOpenSearchResult: (match: SearchMatch) => void;
  /** Opens a file of the workspace in the editor. */
  onOpenFile: (path: string) => void;
  /** Visibility is CSS-only; the sidebar stays mounted to preserve state. */
  visible: boolean;
  /** Bumped by the New File command to start inline creation at the root. */
  createFileSignal: number;
}

function bodyFor(
  activity: ActivityId,
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
    default:
      return null;
  }
}

const TITLES: Record<ActivityId, string> = {
  explorer: 'Explorer',
  search: 'Search',
  scm: 'Source Control',
  settings: 'Settings',
};

export function Sidebar({
  activity,
  focusSignal,
  hasWorkspace,
  onOpenSearchResult,
  onOpenFile,
  visible,
  createFileSignal,
}: SidebarProps): ReactNode {
  const className = `sidebar${visible ? '' : ' sidebar--hidden'}`;
  // The Settings editor keeps the Explorer in the side bar. The explorer
  // renders its own header (title + refresh/close actions).
  if (activity === 'explorer' || activity === 'settings') {
    return (
      <aside className={className} aria-label="Explorer sidebar" aria-hidden={!visible}>
        <Explorer focusSignal={focusSignal} createFileSignal={createFileSignal} />
      </aside>
    );
  }
  return (
    <aside className={className} aria-label={`${TITLES[activity]} sidebar`} aria-hidden={!visible}>
      <div className="sidebar__header">{TITLES[activity]}</div>
      {bodyFor(activity, hasWorkspace, onOpenSearchResult, onOpenFile)}
    </aside>
  );
}
