/**
 * Renderer menu bar.
 *
 * Top-level categories and every item are driven by the menu model, so a
 * click, a keyboard shortcut and the future palette all execute the same
 * command id. Nothing here handles a command directly.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { MenuEntry, MenuItem, MenuSection } from '../../commands/menuModel';
import type { CommandCategory } from '../../commands/types';

interface MenuBarProps {
  sections: readonly MenuSection[];
  /** Visible hint for the first half of a keybinding chord. */
  chordHint: string | null;
  /** Runs a command through the registry with the trusted menu source. */
  onExecute: (id: string) => void;
  /** Captures the element focused before the menu stole focus. */
  onCaptureFocus: () => void;
  /** Lets the shell know whether a dropdown is open (globals are suppressed). */
  onOpenChange: (open: boolean) => void;
}

function enabledIndexAt(section: MenuSection, from: number, step: number): number {
  const length = section.entries.length;
  for (let offset = 1; offset <= length; offset += 1) {
    const raw = from + step * offset;
    const index = ((raw % length) + length) % length;
    const entry = section.entries[index];
    if (entry?.kind === 'item' && entry.enabled) {
      return index;
    }
  }
  return -1;
}

function firstEnabledIndex(section: MenuSection): number {
  return enabledIndexAt(section, -1, 1);
}

function edgeEnabledIndex(section: MenuSection, end: boolean): number {
  const indices = section.entries
    .map((entry, index) => (entry.kind === 'item' && entry.enabled ? index : -1))
    .filter((index) => index >= 0);
  return end ? (indices.at(-1) ?? -1) : (indices[0] ?? -1);
}

export function MenuBar({
  sections,
  chordHint,
  onExecute,
  onCaptureFocus,
  onOpenChange,
}: MenuBarProps): ReactNode {
  const [openCategory, setOpenCategory] = useState<CommandCategory | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topRefs = useRef(new Map<CommandCategory, HTMLButtonElement>());
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTop = (category: CommandCategory): void => {
    topRefs.current.get(category)?.focus();
  };

  const close = (returnFocus = false): void => {
    const previous = openCategory;
    setOpenCategory(null);
    setActiveIndex(-1);
    onOpenChange(false);
    if (returnFocus && previous !== null) {
      focusTop(previous);
    }
  };

  const openAt = (category: CommandCategory): void => {
    if (openCategory === null) {
      onCaptureFocus();
    }
    const section = sections.find((candidate) => candidate.category === category);
    itemRefs.current = [];
    setOpenCategory(category);
    setActiveIndex(section === undefined ? -1 : firstEnabledIndex(section));
    onOpenChange(true);
  };

  const runItem = (item: MenuItem): void => {
    onExecute(item.id);
    close();
  };

  // Move focus into a freshly opened dropdown once its items are mounted.
  useEffect(() => {
    if (openCategory === null || activeIndex < 0) {
      return;
    }
    itemRefs.current[activeIndex]?.focus();
  }, [openCategory, activeIndex]);

  // Outside pointer down and Escape close the dropdown.
  useEffect(() => {
    if (openCategory === null) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [openCategory]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key;
    if (key === 'Escape') {
      if (openCategory !== null) {
        event.preventDefault();
        close(true);
      }
      return;
    }

    if (openCategory === null) {
      const currentIndex = sections.findIndex(
        (section) => topRefs.current.get(section.category) === event.target,
      );
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        const step = key === 'ArrowRight' ? 1 : -1;
        const next = sections[(currentIndex + step + sections.length) % sections.length];
        if (next !== undefined) {
          focusTop(next.category);
        }
      } else if (
        (key === 'ArrowDown' || key === 'Enter' || key === ' ') &&
        currentIndex >= 0
      ) {
        event.preventDefault();
        openAt(sections[currentIndex]!.category);
      }
      return;
    }

    const section = sections.find((candidate) => candidate.category === openCategory);
    if (section === undefined) {
      return;
    }

    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      event.preventDefault();
      const index = sections.findIndex((candidate) => candidate.category === openCategory);
      const step = key === 'ArrowRight' ? 1 : -1;
      const next = sections[(index + step + sections.length) % sections.length];
      if (next !== undefined) {
        openAt(next.category);
      }
      return;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      const next = enabledIndexAt(section, activeIndex, key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) {
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
      }
      return;
    }

    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      const next = edgeEnabledIndex(section, key === 'End');
      if (next >= 0) {
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
      }
      return;
    }

    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      const entry = section.entries[activeIndex];
      if (entry?.kind === 'item' && entry.enabled) {
        runItem(entry);
      }
    }
  };

  const renderEntry = (entry: MenuEntry, index: number): ReactNode => {
    if (entry.kind === 'separator') {
      return (
        <div
          key={`separator-${index}`}
          className="menu-bar__separator"
          role="separator"
        />
      );
    }
    return (
      <button
        key={entry.id}
        ref={(element) => {
          itemRefs.current[index] = element;
        }}
        type="button"
        role={entry.checked === null ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={entry.checked === null ? undefined : entry.checked}
        className={[
          'menu-bar__item',
          activeIndex === index ? 'menu-bar__item--active' : '',
          entry.enabled ? '' : 'menu-bar__item--disabled',
        ]
          .filter((value) => value !== '')
          .join(' ')}
        disabled={!entry.enabled}
        title={entry.disabledReason ?? undefined}
        onClick={() => runItem(entry)}
        onMouseEnter={() => setActiveIndex(index)}
      >
        <span className="menu-bar__check" aria-hidden="true">
          {entry.checked === true ? '✓' : ''}
        </span>
        <span className="menu-bar__label">{entry.label}</span>
        {entry.shortcut === null ? null : (
          <span className="menu-bar__shortcut" aria-hidden="true">
            {entry.shortcut}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className="menu-bar"
      role="menubar"
      aria-label="Main menu"
      ref={rootRef}
      onKeyDown={handleKeyDown}
    >
      {sections.map((section) => {
        const open = openCategory === section.category;
        return (
          <div className="menu-bar__group" key={section.category}>
            <button
              ref={(element) => {
                if (element !== null) {
                  topRefs.current.set(section.category, element);
                } else {
                  topRefs.current.delete(section.category);
                }
              }}
              type="button"
              role="menuitem"
              className={`menu-bar__top${open ? ' menu-bar__top--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => (open ? close() : openAt(section.category))}
              onMouseEnter={() => {
                if (openCategory !== null && openCategory !== section.category) {
                  openAt(section.category);
                }
              }}
            >
              {section.label}
            </button>
            {open ? (
              <div
                className="menu-bar__dropdown"
                role="menu"
                aria-label={`${section.label} menu`}
              >
                {section.entries.map(renderEntry)}
              </div>
            ) : null}
          </div>
        );
      })}
      <span className="menu-bar__spacer" />
      {chordHint === null ? null : (
        <span className="menu-bar__hint" role="status">
          {chordHint} · Esc to cancel
        </span>
      )}
    </div>
  );
}
