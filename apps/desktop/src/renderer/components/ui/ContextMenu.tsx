/**
 * One context-menu primitive for the A6 shell.
 *
 * Items are command ids, not inline callbacks: the caller executes them
 * through the registry so menus, shortcuts and the palette stay in sync.
 * Keyboard: Up/Down move, Enter/Space activate, Escape closes, and focus
 * returns to the invoking element.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: ContextMenuProps): ReactNode {
  const [focused, setFocused] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    menuRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  const move = (delta: number): void => {
    if (enabledIndexes.length === 0) {
      return;
    }
    const position = enabledIndexes.indexOf(focused);
    const next =
      position < 0
        ? enabledIndexes[0]
        : enabledIndexes[(position + delta + enabledIndexes.length) % enabledIndexes.length];
    if (next !== undefined) {
      setFocused(next);
    }
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="Context menu"
      tabIndex={-1}
      style={{ left: x, top: y }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const item = items[focused];
          if (item !== undefined && !item.disabled) {
            onSelect(item.id);
            onClose();
          }
        }
      }}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separatorBefore === true ? (
            <div className="context-menu__separator" role="separator" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`context-menu__item${focused === index ? ' context-menu__item--focused' : ''}`}
            disabled={item.disabled === true}
            tabIndex={-1}
            onMouseEnter={() => setFocused(index)}
            onClick={() => {
              if (!item.disabled) {
                onSelect(item.id);
                onClose();
              }
            }}
          >
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut === undefined ? null : (
              <span className="context-menu__shortcut">{item.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
