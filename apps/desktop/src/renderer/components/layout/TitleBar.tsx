/**
 * Single title row for the application window.
 *
 * The native title bar and native menu are removed in the main process, so
 * this row owns the app mark, the command menu, the document title and the
 * panel controls. `titleBarOverlay` draws the Windows window buttons on the
 * far right; `title-bar__actions` reserves space for them in CSS.
 */
import { useEffect, type ReactNode } from 'react';
import a6Mark from '../../../../icons/a6-32.png';
import type { MenuSection } from '../../commands/menuModel';
import { Icon } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { MenuBar } from './MenuBar';

export interface TitleBarProps {
  sections: readonly MenuSection[];
  chordHint: string | null;
  onExecute: (id: string) => void;
  onCaptureFocus: () => void;
  onOpenChange: (open: boolean) => void;
  /** Workspace or active document name shown in the middle of the row. */
  title: string;
  aiPanelVisible: boolean;
  onToggleAiPanel: () => void;
  onOpenSettings: () => void;
}

const DEFAULT_OVERLAY_WIDTH = 138;

function overlayWidth(): number {
  if (typeof navigator === 'undefined') {
    return DEFAULT_OVERLAY_WIDTH;
  }
  const overlay = (
    navigator as Navigator & {
      windowControlsOverlay?: {
        visible?: boolean;
        getTitlebarAreaRect?: () => DOMRectReadOnly;
      };
    }
  ).windowControlsOverlay;
  if (overlay?.visible && overlay.getTitlebarAreaRect) {
    const rect = overlay.getTitlebarAreaRect();
    const width = Math.max(0, Math.round(window.innerWidth - rect.x));
    if (width > 0) {
      return width;
    }
  }
  return DEFAULT_OVERLAY_WIDTH;
}

export function TitleBar({
  sections,
  chordHint,
  onExecute,
  onCaptureFocus,
  onOpenChange,
  title,
  aiPanelVisible,
  onToggleAiPanel,
  onOpenSettings,
}: TitleBarProps): ReactNode {
  useEffect(() => {
    const apply = (): void => {
      document.documentElement.style.setProperty(
        '--titlebar-overlay-width',
        `${overlayWidth()}px`,
      );
    };
    apply();
    window.addEventListener('resize', apply);
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: {
          addEventListener?: (type: 'geometrychange', listener: () => void) => void;
          removeEventListener?: (type: 'geometrychange', listener: () => void) => void;
        };
      }
    ).windowControlsOverlay;
    overlay?.addEventListener?.('geometrychange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      overlay?.removeEventListener?.('geometrychange', apply);
    };
  }, []);

  return (
    <header className="title-bar">
      <span className="title-bar__brand" aria-hidden="true">
        <img src={a6Mark} alt="" width={18} height={18} draggable={false} />
      </span>
      <MenuBar
        sections={sections}
        onExecute={onExecute}
        onCaptureFocus={onCaptureFocus}
        onOpenChange={onOpenChange}
      />
      <span className="title-bar__title" title={title}>
        {title}
      </span>
      <span className="title-bar__spacer" />
      {chordHint === null ? null : (
        <span className="menu-bar__hint" role="status">
          {chordHint} · Esc to cancel
        </span>
      )}
      <div className="title-bar__actions">
        <IconButton
          label="Toggle AI Panel"
          icon={<Icon name="panelRight" size={16} />}
          active={aiPanelVisible}
          onClick={onToggleAiPanel}
        />
        <IconButton
          label="Settings"
          icon={<Icon name="settings" size={16} />}
          onClick={onOpenSettings}
        />
      </div>
    </header>
  );
}
