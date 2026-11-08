import type { ReactNode } from 'react';

export type ActivityId =
  | 'explorer'
  | 'search'
  | 'scm'
  | 'agent'
  | 'extensions'
  | 'settings';

interface ActivityBarProps {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
}

interface ActivityDefinition {
  id: ActivityId;
  label: string;
  disabled?: boolean;
}

const ACTIVITIES: readonly ActivityDefinition[] = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'search', label: 'Search' },
  { id: 'scm', label: 'Source Control' },
  { id: 'agent', label: 'AI Agent' },
  { id: 'extensions', label: 'Extensions (planned)', disabled: true },
  { id: 'settings', label: 'Settings' },
];

function Icon({ path }: { path: string }): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS: Record<ActivityId, string> = {
  explorer:
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  scm: 'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 6c0 5-6 3-6 9',
  agent: 'M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1M8.4 15.6l-2.1 2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  extensions: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 3h7m-7 4h7',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.85a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.51 1z',
};

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
          disabled={activity.disabled}
          onClick={() => onSelect(activity.id)}
        >
          <Icon path={ICONS[activity.id]} />
        </button>
      ))}
      <span className="activity-bar__spacer" />
    </nav>
  );
}
