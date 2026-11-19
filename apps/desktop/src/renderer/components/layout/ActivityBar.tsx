import type { ReactNode } from 'react';
import { Icon, type IconName } from '../ui/icons';

export type ActivityId = 'explorer' | 'search' | 'scm' | 'settings';

interface ActivityBarProps {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
}

interface ActivityDefinition {
  id: ActivityId;
  label: string;
  icon: IconName;
}

/**
 * The real agent lives in the AI panel's Agent tab, so it is not duplicated
 * here. Extensions had no functionality and is not offered as a dead control.
 */
const ACTIVITIES: readonly ActivityDefinition[] = [
  { id: 'explorer', label: 'Explorer', icon: 'explorer' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'scm', label: 'Source Control', icon: 'scm' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function ActivityBar({ active, onSelect }: ActivityBarProps): ReactNode {
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {ACTIVITIES.map((activity) => (
        <button
          key={activity.id}
          type="button"
          className={`activity-bar__item${
            active === activity.id ? ' activity-bar__item--active' : ''
          }`}
          title={activity.label}
          aria-label={activity.label}
          aria-current={active === activity.id ? 'page' : undefined}
          onClick={() => onSelect(activity.id)}
        >
          <Icon name={activity.icon} size={20} />
        </button>
      ))}
      <span className="activity-bar__spacer" />
    </nav>
  );
}
