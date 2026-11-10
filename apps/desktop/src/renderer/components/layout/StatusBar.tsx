import type { ReactNode } from 'react';
import type { AppInfo } from '../../../shared/ipc-types';
import type { Theme } from '../../hooks/useTheme';
import { LANGUAGES } from '../../utils/language';

interface CursorPosition {
  line: number;
  column: number;
}

interface StatusBarProps {
  language: string | null;
  onLanguageChange: (language: string) => void;
  cursor: CursorPosition;
  theme: Theme;
  onToggleTheme: () => void;
  appInfo: AppInfo | null;
  /** Display name of the active workspace (null when no folder is open). */
  workspaceName: string | null;
  /** Canonical root of the active workspace (for the tooltip). */
  workspaceRoot: string | null;
}

export function StatusBar({
  language,
  onLanguageChange,
  cursor,
  theme,
  onToggleTheme,
  appInfo,
  workspaceName,
  workspaceRoot,
}: StatusBarProps): ReactNode {
  return (
    <footer className="status-bar" aria-label="Status bar">
      <span
        className="status-bar__item"
        title={workspaceRoot ?? 'No folder open'}
      >
        {workspaceName ?? 'No folder open'}
      </span>
      <span className="status-bar__item" title="Git integration (Milestone 3)">
        Git: —
      </span>

      <span className="status-bar__spacer" />

      <span className="status-bar__item" title="Language of the active buffer">
        <select
          aria-label="Language of the active buffer"
          value={language ?? 'plaintext'}
          disabled={language === null}
          onChange={(event) => onLanguageChange(event.target.value)}
          style={{
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            font: 'inherit',
            cursor: language === null ? 'not-allowed' : 'pointer',
          }}
        >
          {LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </span>

      <span className="status-bar__item" title="Cursor position">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <span className="status-bar__item" title="Buffer encoding">
        UTF-8
      </span>

      <button
        type="button"
        className="status-bar__item"
        onClick={onToggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? '☾ Dark' : '☀ Light'}
      </button>

      <span
        className="status-bar__item status-bar__item--accent"
        title={
          appInfo
            ? `Electron ${appInfo.electronVersion} · Chrome ${appInfo.chromeVersion} · Node ${appInfo.nodeVersion}`
            : 'Application information'
        }
      >
        {appInfo
          ? `NOVA IDE ${appInfo.appVersion} · Electron ${appInfo.electronVersion}`
          : 'NOVA IDE'}
      </span>
    </footer>
  );
}
