import type { ReactNode } from 'react';
import { Icon } from '../../components/ui/icons';
import { FileIcon } from '../explorer/fileIcons';
import type { EditorTab } from '../../stores/tabsReducer';
import { breadcrumbSegments } from './breadcrumbModel';

interface BreadcrumbsProps {
  tab: EditorTab | null;
  workspaceRoot: string | null;
  workspaceName: string | null;
}

/** Path trail shown directly under the tab strip for the active file. */
export function Breadcrumbs({
  tab,
  workspaceRoot,
  workspaceName,
}: BreadcrumbsProps): ReactNode {
  if (tab === null || tab.kind === 'settings') {
    return <div className="breadcrumbs breadcrumbs--empty" aria-hidden="true" />;
  }
  const segments = breadcrumbSegments(
    tab.filePath,
    workspaceRoot,
    tab.name,
  );
  return (
    <nav className="breadcrumbs" aria-label="File breadcrumbs">
      {segments.map((segment, index) => (
        <span className="breadcrumbs__segment" key={`${segment.label}-${index}`}>
          {index > 0 ? (
            <Icon name="chevronLeft" size={11} className="breadcrumbs__sep" />
          ) : null}
          {index === segments.length - 1 && tab.filePath !== null ? (
            <FileIcon name={tab.name} kind="file" expanded={false} />
          ) : null}
          <span className="breadcrumbs__label">
            {index === 0 &&
            tab.filePath !== null &&
            workspaceName !== null &&
            segment.path === null
              ? workspaceName
              : segment.label}
          </span>
        </span>
      ))}
    </nav>
  );
}
