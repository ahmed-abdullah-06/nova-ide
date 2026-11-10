import { useEffect, useRef, type ReactNode } from 'react';
import type { FileEntry } from '../../../../shared/ipc-types';

export interface ExplorerMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface ExplorerContextMenuProps {
  menu: ExplorerMenuState;
  /** True when the entry is the workspace root (rename/delete hidden). */
  isRoot: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 28;
/** Extra items beyond the 4 defaults are not expected, but stay in view. */
const MENU_MAX_HEIGHT = 200;

/**
 * Explorer right-click menu (spec §7.1, §10): New File, New Folder,
 * Rename, Delete. Rendered in a fixed layer, dismissed by Escape or an
 * outside click, and clamped to the viewport.
 */
export function ExplorerContextMenu({
  menu,
  isRoot,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: ExplorerContextMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node) !== true) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  const left = Math.max(
    4,
    Math.min(menu.x, window.innerWidth - MENU_WIDTH - 4),
  );
  const top = Math.max(
    4,
    Math.min(menu.y, window.innerHeight - MENU_MAX_HEIGHT - 4),
  );

  const item = (
    label: string,
    onSelect: () => void,
    danger = false,
  ): ReactNode => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className={`explorer__menu-item${danger ? ' explorer__menu-item--danger' : ''}`}
      onClick={() => {
        onClose();
        onSelect();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="explorer__menu"
      role="menu"
      aria-label="File actions"
      style={{ left, top, width: MENU_WIDTH }}
      // Keep the tree selection stable while the menu is open.
      onContextMenu={(event) => event.preventDefault()}
    >
      {item('New File', onNewFile)}
      {item('New Folder', onNewFolder)}
      {isRoot ? null : (
        <>
          {item('Rename', onRename)}
          {item('Delete', onDelete, true)}
        </>
      )}
      <span className="explorer__menu-hint" style={{ height: ITEM_HEIGHT }}>
        {menu.entry.kind === 'directory' ? 'Folder' : 'File'} ·{' '}
        {menu.entry.name}
      </span>
    </div>
  );
}
