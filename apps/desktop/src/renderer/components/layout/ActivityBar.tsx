import type { ReactNode } from 'react';
import { Icon, type IconName } from '../ui/icons';

export type ActivityId = 'explorer' | 'search' | 'scm' | 'settings';

interface ActivityBarProps {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
  /** Number of changed paths reported by git for the open workspace. */
  changeCount?: number;
}

interface ActivityDefinition {
  id: ActivityId;
  label: string;
  icon: IconName;
  shortcut: string;
}

/**
 * The real agent lives in the AI panel's Agent tab, so it is not duplicated
 * here. Extensions had no functionality and is not offered as a dead control.
 */
const ACTIVITIES: readonly ActivityDefinition[] = [
  { id: 'explorer', label: 'Explorer', icon: 'explorer', shortcut: 'Ctrl+Shift+E' },
  { id: 'search', label: 'Search', icon: 'search', shortcut: 'Ctrl+Shift+F' },
  { id: 'scm', label: 'Source Control', icon: 'scm', shortcut: 'Ctrl+Shift+G' },
];

const SETTINGS: ActivityDefinition = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  shortcut: 'Ctrl+,',
};

function item(definition: ActivityDefinition, props: ActivityBarProps): ReactNode {
  const active = props.active === definition.id;
  const showBadge =
    definition.id === 'scm' &&
    props.changeCount !== undefined &&
    props.changeCount > 0;
  return (
    <button
      key={definition.id}
      type="button"
      className={`activity-bar__item${
        active ? ' activity-bar__item--active' : ''
      }`}
      title={`${definition.label} (${definition.shortcut})`}
      aria-label={definition.label}
      aria-keyshortcuts={definition.shortcut}
      aria-current={active ? 'page' : undefined}
      onClick={() => props.onSelect(definition.id)}
    >
      <Icon name={definition.icon} size={20} />
      {showBadge ? (
        <span
          className="activity-bar__badge"
          aria-label={`${props.changeCount ?? 0} changes`}
        >
          {props.changeCount}
        </span>
      ) : null}
    </button>
  );
}

export function ActivityBar(props: ActivityBarProps): ReactNode {
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {ACTIVITIES.map((activity) => item(activity, props))}
      <span className="activity-bar__spacer" />
      {item(SETTINGS, props)}
    </nav>
  );
}
