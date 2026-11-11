/**
 * Source control view of the sidebar (spec §16).
 *
 * Shows the branch, the staged/unstaged/untracked files and offers the
 * actions of the milestone. Discarding changes is destructive, so it always
 * asks for confirmation first (the same pattern the explorer uses for
 * deletions).
 */
import { useCallback, useState } from 'react';
import type { GitFileChange } from '../../../shared/ipc-types';
import { useGit } from './useGit';

export interface SourceControlViewProps {
  /** True when a workspace is open. */
  hasWorkspace: boolean;
  /** Opens a file of the workspace in the editor. */
  onOpenFile: (path: string) => void;
}

export function SourceControlView({
  hasWorkspace,
  onOpenFile,
}: SourceControlViewProps): React.JSX.Element {
  const git = useGit(hasWorkspace);
  const [message, setMessage] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const status = git.status;

  const handleDiscard = useCallback(
    (change: GitFileChange): void => {
      const confirmed = window.confirm(
        `Discard the changes of "${change.relativePath}"?\n\n` +
          'The file will be restored to its last committed state.\n\n' +
          'This cannot be undone.',
      );
      if (!confirmed) {
        return;
      }
      git.discard(change.path);
    },
    [git],
  );

  const handleCommit = useCallback((): void => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return;
    }
    git.commit(trimmed);
    setMessage('');
  }, [git, message]);

  const handleShowDiff = useCallback(
    async (change: GitFileChange, staged: boolean): Promise<void> => {
      const text = await git.diff(change.path, staged);
      setDiff(text);
      setDiffPath(change.relativePath);
    },
    [git],
  );

  if (!hasWorkspace) {
    return (
      <p className="source-control__empty">Open a folder to use source control.</p>
    );
  }

  if (status !== null && !status.isRepository) {
    return (
      <p className="source-control__empty">
        This folder is not a Git repository.
      </p>
    );
  }

  const renderGroup = (
    title: string,
    changes: GitFileChange[],
    staged: boolean,
  ): React.JSX.Element | null => {
    if (changes.length === 0) {
      return null;
    }
    return (
      <section className="source-control__group">
        <h3 className="source-control__group-title">
          {title} ({changes.length})
        </h3>
        <ul className="source-control__list">
          {changes.map((change) => (
            <li key={`${staged}:${change.path}`} className="source-control__item">
              <button
                type="button"
                className="source-control__name"
                onClick={() => onOpenFile(change.path)}
                title={change.relativePath}
              >
                {change.relativePath}
              </button>
              <span className="source-control__status">{change.status}</span>
              <button
                type="button"
                className="source-control__action"
                onClick={() => void handleShowDiff(change, staged)}
                title="Show the diff"
              >
                Diff
              </button>
              {staged ? (
                <button
                  type="button"
                  className="source-control__action"
                  onClick={() => git.unstage(change.path)}
                  title="Unstage this file"
                >
                  Unstage
                </button>
              ) : (
                <button
                  type="button"
                  className="source-control__action"
                  onClick={() => git.stage(change.path)}
                  title="Stage this file"
                >
                  Stage
                </button>
              )}
              {staged ? null : (
                <button
                  type="button"
                  className="source-control__action source-control__action--danger"
                  onClick={() => handleDiscard(change)}
                  title="Discard the local changes of this file"
                >
                  Discard
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="source-control">
      <div className="source-control__header">
        <span className="source-control__branch">
          {status?.branch ?? '…'}
          {status !== null && status.upstream !== null ? (
            <span className="source-control__upstream">
              {' '}
              ({status.ahead}↑ {status.behind}↓)
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="source-control__action"
          onClick={git.refresh}
          disabled={git.busy}
          title="Refresh the status"
        >
          Refresh
        </button>
      </div>

      {git.error !== null ? (
        <p className="source-control__error" role="alert">
          {git.error}
        </p>
      ) : null}

      <div className="source-control__commit">
        <input
          type="text"
          className="source-control__message"
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleCommit();
            }
          }}
        />
        <button
          type="button"
          className="source-control__commit-button"
          onClick={handleCommit}
          disabled={git.busy || message.trim().length === 0}
          title="Commit the staged changes"
        >
          Commit
        </button>
      </div>

      {status !== null ? (
        <>
          {renderGroup('Staged', status.staged, true)}
          {renderGroup('Changes', status.unstaged, false)}
          {renderGroup('Untracked', status.untracked, false)}
        </>
      ) : null}

      {diff !== null && diffPath !== null ? (
        <section className="source-control__diff">
          <h3 className="source-control__group-title">{diffPath}</h3>
          <pre className="source-control__diff-body">{diff}</pre>
        </section>
      ) : null}
    </div>
  );
}
