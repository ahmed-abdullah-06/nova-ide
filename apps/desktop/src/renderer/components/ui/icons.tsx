import type { ReactNode } from 'react';

/** Icon names used by the shared A6 UI. */
export type IconName =
  | 'app'
  | 'explorer'
  | 'search'
  | 'scm'
  | 'settings'
  | 'ai'
  | 'newChat'
  | 'history'
  | 'more'
  | 'mic'
  | 'send'
  | 'stop'
  | 'attach'
  | 'chevronDown'
  | 'chevronRight'
  | 'close'
  | 'check'
  | 'shield'
  | 'diff'
  | 'regenerate'
  | 'delete'
  | 'edit'
  | 'refresh'
  | 'download'
  | 'unload'
  | 'details'
  | 'theme'
  | 'panelRight'
  | 'file'
  | 'warning'
  | 'info'
  | 'error'
  | 'success'
  | 'terminal'
  | 'output'
  | 'link'
  | 'keyboard';

const ICON_PATHS: Record<IconName, readonly string[]> = {
  app: ['M5 19 12 5l7 14M8 14h8'],
  explorer: [
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  ],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35'],
  scm: [
    'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 6c0 5-6 3-6 9',
  ],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.85a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.51 1z',
  ],
  ai: [
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
    'M18 16l.7 1.9 1.9.7-1.9.7L18 21l-.7-1.7-1.9-.7 1.9-.7L18 16z',
  ],
  newChat: ['M4 5h16v11H9l-5 4V5zM12 9v4M10 11h4'],
  history: ['M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l4 2'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  mic: [
    'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z',
    'M5 11a7 7 0 0 0 14 0M12 18v3',
  ],
  send: ['M4 12l16-8-6 16-3-6-7-2z'],
  stop: ['M7 7h10v10H7z'],
  attach: ['M9 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12l4 4L19 6'],
  shield: ['M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z'],
  diff: [
    'M7 4v10m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10-8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 4v2c0 3-3 2-3 6',
  ],
  regenerate: ['M4 12a8 8 0 1 1 2.3 5.7M4 18v-5h5'],
  delete: [
    'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  ],
  edit: ['M4 20h4l11-11-4-4L4 16v4zM14 6l4 4'],
  refresh: ['M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5'],
  download: ['M12 4v12m0 0l-5-5m5 5l5-5M4 20h16'],
  unload: ['M12 20V8m0 0l-5 5m5-5l5 5M4 4h16'],
  details: [
    'M12 16v-4m0-4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  ],
  theme: [
    'M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6L4.2 4.2m14.2 14.2l1.4 1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  ],
  panelRight: ['M4 5h16v14H4V5zm11 0v14'],
  file: ['M6 3h8l4 4v14H6V3zm8 0v4h4'],
  warning: ['M12 4l9 16H3l9-16zm0 6v4m0 3h.01'],
  info: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v6m0-10h.01',
  ],
  error: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-3 6l6 6m0-6l-6 6',
  ],
  success: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-4 9l3 3 5-6',
  ],
  terminal: ['M5 7l4 4-4 4M11 17h8'],
  output: ['M4 5h16M4 10h16M4 15h10'],
  link: [
    'M10 14a4 4 0 0 0 6 .4l2-2a4 4 0 0 0-5.7-5.7L11 8M14 10a4 4 0 0 0-6-.4l-2 2A4 4 0 0 0 11.7 17L13 16',
  ],
  keyboard: [
    'M4 6h16v12H4V6zm3 3h.01M10 9h.01M13 9h.01M16 9h.01M7 12h.01M10 12h.01M13 12h.01M16 12h.01M8 15h8',
  ],
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible label; omit for decorative icons. */
  title?: string;
}

/** Renders an inline SVG from the shared A6 icon set. */
export function Icon({
  name,
  size = 16,
  className,
  title,
}: IconProps): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title === undefined ? undefined : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      {title === undefined ? null : <title>{title}</title>}
      {ICON_PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
