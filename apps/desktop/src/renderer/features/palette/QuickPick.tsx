/** Shared keyboard-only quick-pick surface for palette and Quick Open. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../../components/ui/icons';

export interface QuickPickRow {
  id: string;
  label: string;
  description?: string;
  category?: string;
  shortcut?: string | null;
  /** File result location; absent for command rows. */
  path?: string;
  line?: number;
  column?: number;
}

export interface QuickPickProps {
  title: string;
  placeholder: string;
  query: string;
  rows: readonly QuickPickRow[];
  status?: string;
  emptyMessage: string;
  onQueryChange: (value: string) => void;
  onChoose: (row: QuickPickRow) => void;
  onClose: () => void;
}

/** A single input + listbox; all navigation works from the keyboard. */
export function QuickPick({
  title,
  placeholder,
  query,
  rows,
  status,
  emptyMessage,
  onQueryChange,
  onChoose,
  onClose,
}: QuickPickProps): ReactNode {
  const [selected, setSelected] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const rowKey = rows.map((row) => row.id).join('\u0000');
  useEffect(() => {
    setSelected(0);
  }, [query, rowKey]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointer, true);
    return () => document.removeEventListener('pointerdown', handlePointer, true);
  }, [onClose]);

  const clamped = rows.length === 0 ? 0 : Math.min(selected, rows.length - 1);

  const handleKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((value) => (rows.length === 0 ? 0 : (value + 1) % rows.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((value) =>
        rows.length === 0 ? 0 : (value - 1 + rows.length) % rows.length,
      );
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      setSelected((value) => Math.min(value + 10, Math.max(rows.length - 1, 0)));
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      setSelected((value) => Math.max(value - 10, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[clamped];
      if (row !== undefined) {
        onChoose(row);
      }
    }
  };

  const activeId = rows.length === 0 ? undefined : `quick-pick-option-${clamped}`;

  return (
    <div className="dialog-backdrop quick-pick-backdrop">
      <div
        className="quick-pick"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="quick-pick__input-row">
          <Icon name="commandCenter" size={15} className="quick-pick__icon" />
          <input
            type="text"
            className="quick-pick__input"
            aria-label={title}
            aria-controls="quick-pick-list"
            aria-activedescendant={activeId}
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKey}
          />
          <kbd className="quick-pick__escape">Esc</kbd>
        </div>
        <div className="quick-pick__meta">
          <span>{title}</span>
          {status === undefined ? null : <span className="quick-pick__status">{status}</span>}
        </div>
        <div
          className="quick-pick__list"
          id="quick-pick-list"
          role="listbox"
          aria-label={`${title} results`}
        >
          {rows.map((row, index) => (
            <button
              type="button"
              key={row.id}
              id={`quick-pick-option-${index}`}
              role="option"
              aria-selected={index === clamped}
              className={`quick-pick__row${index === clamped ? ' quick-pick__row--active' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onChoose(row)}
            >
              <span className="quick-pick__label">
                {row.category === undefined ? null : (
                  <span className="quick-pick__category">{row.category}</span>
                )}
                <span className="quick-pick__name">{row.label}</span>
              </span>
              {row.description === undefined ? null : (
                <span className="quick-pick__description">{row.description}</span>
              )}
              {row.shortcut == null ? null : (
                <span className="quick-pick__shortcut">{row.shortcut}</span>
              )}
            </button>
          ))}
          {rows.length === 0 ? (
            <p className="quick-pick__empty">{emptyMessage}</p>
          ) : null}
        </div>
        <div className="quick-pick__footer">
          <span>↑↓ Navigate</span>
          <span>Enter Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
