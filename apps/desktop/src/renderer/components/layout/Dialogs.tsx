/** Help dialogs: searchable shortcut reference and real build metadata. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppInfo } from '../../../shared/ipc-types';
import { describeKeybinding } from '../../commands/keybindings';
import { MENU_CATEGORIES } from '../../commands/menuModel';
import type { CommandDefinition, Platform } from '../../commands/types';

interface DialogProps {
  onClose: () => void;
  title: string;
  children: ReactNode;
}

function Dialog({ onClose, title, children }: DialogProps): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handlePointer = (event: PointerEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('pointerdown', handlePointer, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('pointerdown', handlePointer, true);
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <header className="dialog__header">
          <h2 className="dialog__title">{title}</h2>
          <button
            type="button"
            className="dialog__close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}

export interface ShortcutsDialogProps {
  definitions: readonly CommandDefinition[];
  platform: Platform;
  onClose: () => void;
}

export function ShortcutsDialog({
  definitions,
  platform,
  onClose,
}: ShortcutsDialogProps): ReactNode {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return definitions;
    }
    return definitions.filter((definition) => {
      const spec = definition.keybindings?.[platform];
      const label = spec == null ? '' : describeKeybinding(spec, platform);
      return (
        definition.title.toLowerCase().includes(needle) ||
        definition.category.toLowerCase().includes(needle) ||
        label.toLowerCase().includes(needle)
      );
    });
  }, [definitions, platform, query]);

  return (
    <Dialog onClose={onClose} title="Keyboard Shortcuts Reference">
      <input
        type="search"
        className="dialog__search"
        placeholder="Search commands or keys"
        aria-label="Search commands or keys"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <div className="dialog__list">
        {MENU_CATEGORIES.map((category) => {
          const rows = filtered.filter((definition) => definition.category === category);
          if (rows.length === 0) {
            return null;
          }
          return (
            <section key={category} className="dialog__group">
              <h3 className="dialog__group-title">{category}</h3>
              {rows.map((definition) => {
                const spec = definition.keybindings?.[platform];
                return (
                  <div key={definition.id} className="dialog__row">
                    <span className="dialog__row-label">{definition.title}</span>
                    <span className="dialog__row-shortcut">
                      {spec == null ? '—' : describeKeybinding(spec, platform)}
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
        {filtered.length === 0 ? (
          <p className="dialog__empty">No commands match “{query}”.</p>
        ) : null}
      </div>
      <p className="dialog__note">
        Shortcuts follow this platform ({
          platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows'
        }). Monaco owns Find, Replace and Undo/Redo while the editor has focus.
      </p>
    </Dialog>
  );
}

export interface AboutDialogProps {
  appInfo: AppInfo | null;
  onClose: () => void;
}

export function AboutDialog({ appInfo, onClose }: AboutDialogProps): ReactNode {
  return (
    <Dialog onClose={onClose} title="About A6 IDE">
      {appInfo === null ? (
        <p className="dialog__note">Reading application metadata…</p>
      ) : (
        <dl className="dialog__meta">
          <div>
            <dt>Application</dt>
            <dd>{appInfo.appName}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{appInfo.appVersion}</dd>
          </div>
          <div>
            <dt>Packaged</dt>
            <dd>{appInfo.isPackaged ? 'Yes' : 'No (development)'}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{appInfo.platform}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{appInfo.electronVersion}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{appInfo.chromeVersion}</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>{appInfo.nodeVersion}</dd>
          </div>
        </dl>
      )}
      <p className="dialog__note">
        A6 is a local-first editor. Files and AI runs stay on this machine unless
        you explicitly configure a remote provider.
      </p>
    </Dialog>
  );
}
