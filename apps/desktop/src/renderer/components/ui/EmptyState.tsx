import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** One-sentence empty panel with a single optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps): ReactNode {
  return (
    <div className="ui-empty-state">
      {icon === undefined ? null : (
        <div className="ui-empty-state__icon">
          <Icon name={icon} size={28} />
        </div>
      )}
      <p className="ui-empty-state__title">{title}</p>
      {description === undefined ? null : (
        <p className="ui-empty-state__description">{description}</p>
      )}
      {action === undefined ? null : (
        <div className="ui-empty-state__action">{action}</div>
      )}
    </div>
  );
}
