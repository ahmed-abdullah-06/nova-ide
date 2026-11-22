/**
 * xterm colour mirrors for the A6 dark/light tokens (LF5).
 *
 * The terminal used to stay dark in both themes. These values mirror the same
 * CSS custom properties used by the rest of the shell so the light-theme pass
 * covers the terminal without any new bridge call or dependency.
 */
import type { ITheme } from '@xterm/xterm';
import type { Theme } from '../../hooks/useTheme';

export const TERMINAL_THEMES: Readonly<Record<Theme, ITheme>> = {
  dark: {
    background: '#1f1f1f',
    foreground: '#cccccc',
    cursor: '#4da3f0',
    cursorAccent: '#1f1f1f',
    selectionBackground: 'rgba(0, 120, 212, 0.25)',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f1f1f',
    cursor: '#005a9e',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(0, 120, 212, 0.18)',
  },
};
