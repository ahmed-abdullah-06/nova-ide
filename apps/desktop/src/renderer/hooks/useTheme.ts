import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'nova.theme';

// Kept in sync with --surface-chrome / --text in styles/tokens.css (LF1).
const TITLEBAR_OVERLAY: Record<Theme, { color: string; symbolColor: string }> = {
  dark: { color: '#181818', symbolColor: '#cccccc' },
  light: { color: '#f8f8f8', symbolColor: '#1f1f1f' },
};

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light'
      ? 'light'
      : 'dark';
  } catch {
    // Storage may be unavailable; fall back to the default theme.
    return 'dark';
  }
}

/**
 * Theme preference with persistence (spec §6.2 — dark/light themes,
 * store theme preferences).
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persistence is best-effort; the theme still applies for this session.
    }
    // Keep Windows caption buttons the same colour as the custom title row.
    // Other platforms have no overlay; the main process ignores it there.
    void window.nova?.window.setTitleBarOverlay(TITLEBAR_OVERLAY[theme]).catch(() => {
      // Best-effort; the theme itself has already applied.
    });
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
