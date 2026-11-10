import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { FileEntry } from '../../../../shared/ipc-types';
import type { WorkspaceState } from '../../../stores/workspaceReducer';
import { FileIcon } from '../fileIcons';

interface FileTreeNodeProps {
  entry: FileEntry;
  /** Indentation level (workspace root = 0). */
  depth: number;
  state: WorkspaceState;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onOpenFile: (entry: FileEntry) => void;
  onRetry: (path: string) => void;
  onContextMenu?: (event: ReactMouseEvent, entry: FileEntry) => void;
}

/**
 * One row of the lazy file tree (spec §7.1).
 * Directories render their children only when expanded AND loaded — the
 * explorer never reads more than one level at a time.
 */
export function FileTreeNode({
  entry,
  depth,
  state,
  onToggle,
  onSelect,
  onOpenFile,
  onRetry,
  onContextMenu,
}: FileTreeNodeProps): ReactNode {
  const isDirectory = entry.kind === 'directory';
  const expanded = isDirectory && state.expandedPaths.includes(entry.path);
  const selected = state.selectedPath === entry.path;
  const directoryState = state.directories[entry.path];
  const indent = 6 + depth * 14;

  const handleClick = (): void => {
    onSelect(entry.path);
    if (isDirectory) {
      onToggle(entry.path);
    } else {
      onOpenFile(entry);
    }
  };

  return (
    <>
      <div
        className={
          `tree-node${selected ? ' tree-node--selected' : ''}` +
          `${isDirectory ? ' tree-node--directory' : ''}`
        }
        style={{ paddingLeft: indent }}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={isDirectory ? expanded : undefined}
        tabIndex={-1}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu?.(event, entry);
        }}
      >
        <span
          className={`tree-node__chevron${
            expanded ? ' tree-node__chevron--open' : ''
          }`}
          aria-hidden="true"
        >
          {isDirectory ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                d="M4.5 2.5 8 6l-3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
        <FileIcon name={entry.name} kind={entry.kind} expanded={expanded} />
        <span className="tree-node__label">{entry.name}</span>
        {directoryState?.loading ? (
          <span className="tree-node__spinner" aria-label="Loading" />
        ) : null}
      </div>

      {isDirectory && expanded ? (
        <div className="tree-node__children" role="group">
          {directoryState === undefined ? (
            <div className="tree-node__hint" style={{ paddingLeft: indent + 22 }}>
              Loading…
            </div>
          ) : directoryState.error !== null ? (
            <div
              className="tree-node__error"
              style={{ paddingLeft: indent + 22 }}
            >
              <span className="tree-node__error-text">
                ⚠ {directoryState.error}
              </span>
              <button
                type="button"
                className="tree-node__retry"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetry(entry.path);
                }}
              >
                Retry
              </button>
            </div>
          ) : directoryState.loading ? null : directoryState.entries.length ===
            0 ? (
            <div className="tree-node__hint" style={{ paddingLeft: indent + 22 }}>
              (empty folder)
            </div>
          ) : (
            directoryState.entries.map((child) => (
              <FileTreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                state={state}
                onToggle={onToggle}
                onSelect={onSelect}
                onOpenFile={onOpenFile}
                onRetry={onRetry}
                onContextMenu={onContextMenu}
              />
            ))
          )}
          {directoryState !== undefined &&
          directoryState.truncated &&
          !directoryState.loading &&
          directoryState.error === null ? (
            <div
              className="tree-node__hint"
              style={{ paddingLeft: indent + 22 }}
            >
              … large folder: only the first entries are shown
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
