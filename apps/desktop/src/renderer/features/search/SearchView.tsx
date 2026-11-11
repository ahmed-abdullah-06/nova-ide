/**
 * Search view of the sidebar (spec §7, §21).
 *
 * Searches file names or file contents inside the active workspace and
 * opens a result in the editor at the matching line.
 */
import { useCallback } from 'react';
import type { SearchMatch } from '../../../shared/ipc-types';
import { useSearch } from './useSearch';

export interface SearchViewProps {
  /** True when a workspace is open (searching needs one). */
  hasWorkspace: boolean;
  /** Opens a result in the editor. */
  onOpenResult: (match: SearchMatch) => void;
}

export function SearchView({
  hasWorkspace,
  onOpenResult,
}: SearchViewProps): React.JSX.Element {
  const search = useSearch();

  const handleOpen = useCallback(
    (match: SearchMatch): void => {
      onOpenResult(match);
    },
    [onOpenResult],
  );

  return (
    <div className="search-view">
      <div className="search-view__controls">
        <input
          type="search"
          className="search-view__input"
          placeholder="Search"
          aria-label="Search the workspace"
          value={search.input}
          disabled={!hasWorkspace}
          onChange={(event) => search.setInput(event.target.value)}
        />
        <div className="search-view__modes" role="radiogroup" aria-label="Search mode">
          <button
            type="button"
            role="radio"
            aria-checked={search.mode === 'files'}
            className={`search-view__mode${
              search.mode === 'files' ? ' search-view__mode--active' : ''
            }`}
            onClick={() => search.setMode('files')}
          >
            Files
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={search.mode === 'content'}
            className={`search-view__mode${
              search.mode === 'content' ? ' search-view__mode--active' : ''
            }`}
            onClick={() => search.setMode('content')}
          >
            Content
          </button>
        </div>
      </div>

      {!hasWorkspace ? (
        <p className="search-view__empty">Open a folder to search it.</p>
      ) : search.searching ? (
        <p className="search-view__empty" role="status">
          Searching…
        </p>
      ) : search.input.length === 0 ? (
        <p className="search-view__empty">Type to search the workspace.</p>
      ) : search.results.length === 0 && !search.searching ? (
        <p className="search-view__empty">No results for “{search.pattern}”.</p>
      ) : (
        <>
          {search.truncated ? (
            <p className="search-view__notice">
              Too many results — the list was truncated.
            </p>
          ) : null}
          <ul className="search-view__results">
            {search.results.map((match, index) => (
              <li key={`${match.path}:${match.line}:${match.column}:${index}`}>
                <button
                  type="button"
                  className="search-view__result"
                  onClick={() => handleOpen(match)}
                  title={match.relativePath}
                >
                  <span className="search-view__result-name">{match.name}</span>
                  {match.line > 0 ? (
                    <span className="search-view__result-location">
                      {match.line}:{match.column}
                    </span>
                  ) : null}
                  <span className="search-view__result-preview">
                    {match.preview}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
