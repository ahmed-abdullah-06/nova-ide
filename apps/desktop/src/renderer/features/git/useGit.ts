/**
 * Git state for the renderer (spec §16).
 *
 * The renderer never talks to git directly: it asks the main process for
 * the status and for the individual actions (stage, unstage, discard,
 * commit). Every action returns the new status, so the view stays in sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranch, GitStatus } from '../../../shared/ipc-types';

/** The status of a workspace that is not a repository. */
const NOT_A_REPOSITORY: GitStatus = {
  isRepository: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
};

export interface GitController {
  /** The current status, or null while it is still unknown. */
  status: GitStatus | null;
  /** The local branches of the repository. */
  branches: GitBranch[];
  /** The last error message. */
  error: string | null;
  /** True while a git command is running. */
  busy: boolean;
  /** Re-reads the status. */
  refresh: () => void;
  /** Stages a path. */
  stage: (path: string) => void;
  /** Unstages a path. */
  unstage: (path: string) => void;
  /** Discards the local changes of a path (the caller confirms first). */
  discard: (path: string) => void;
  /** Creates a commit. */
  commit: (message: string) => void;
  /** Reads the diff of a path. */
  diff: (path: string, staged: boolean) => Promise<string | null>;
  /** Checks out another local branch. */
  switchBranch: (name: string) => void;
}

export function useGit(enabled: boolean): GitController {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback((): void => {
    const api = window.nova;
    if (!api || !enabled) {
      setStatus(NOT_A_REPOSITORY);
      return;
    }
    void api.git.status().then((result) => {
      if (!mountedRef.current) {
        return;
      }
      if (result.ok) {
        setStatus(result.value);
        setError(null);
      } else {
        setStatus(NOT_A_REPOSITORY);
        setError(result.message);
      }
    });
  }, [enabled]);

  // The branches are read together with the status.
  const loadBranches = useCallback((): void => {
    const api = window.nova;
    if (!api || !enabled) {
      setBranches([]);
      return;
    }
    void api.git.branches().then((result) => {
      if (!mountedRef.current) {
        return;
      }
      setBranches(result.ok ? result.value : []);
    });
  }, [enabled]);

  // The status is refreshed when the workspace changes; there is no
  // polling, because a busy repository makes polling expensive (the git
  // status is explicit instead).
  useEffect(() => {
    refresh();
    loadBranches();
  }, [refresh, loadBranches]);

  const run = useCallback(
    (
      action: () => Promise<{ ok: boolean; message: string }>,
    ): void => {
      setBusy(true);
      void action()
        .then((result) => {
          if (!mountedRef.current) {
            return;
          }
          setError(result.ok ? null : result.message);
          refresh();
          loadBranches();
        })
        .catch((error: unknown) => {
          if (!mountedRef.current) {
            return;
          }
          setError(
            error instanceof Error ? error.message : 'The Git command failed',
          );
        })
        // The busy state is always released, even when the command failed —
        // a stuck spinner would block the whole view.
        .finally(() => {
          if (mountedRef.current) {
            setBusy(false);
          }
        });
    },
    [refresh, loadBranches],
  );

  const stage = useCallback(
    (path: string): void => {
      run(async () => {
        const result = await window.nova?.git.stage(path);
        return result?.ok === true
          ? { ok: true, message: '' }
          : { ok: false, message: result?.message ?? 'Git is unavailable' };
      });
    },
    [run],
  );

  const unstage = useCallback(
    (path: string): void => {
      run(async () => {
        const result = await window.nova?.git.unstage(path);
        return result?.ok === true
          ? { ok: true, message: '' }
          : { ok: false, message: result?.message ?? 'Git is unavailable' };
      });
    },
    [run],
  );

  const discard = useCallback(
    (path: string): void => {
      run(async () => {
        const result = await window.nova?.git.discard(path);
        return result?.ok === true
          ? { ok: true, message: '' }
          : { ok: false, message: result?.message ?? 'Git is unavailable' };
      });
    },
    [run],
  );

  const commit = useCallback(
    (message: string): void => {
      run(async () => {
        const result = await window.nova?.git.commit(message);
        return result?.ok === true
          ? { ok: true, message: '' }
          : { ok: false, message: result?.message ?? 'Git is unavailable' };
      });
    },
    [run],
  );

  const switchBranch = useCallback(
    (name: string): void => {
      const api = window.nova;
      if (!api) {
        return;
      }
      setBusy(true);
      // The answer already carries the new status, so the repository does
      // not have to be read again.
      void api.git
        .switchBranch(name)
        .then((result) => {
          if (!mountedRef.current) {
            return;
          }
          if (result.ok) {
            setStatus(result.value);
            setError(null);
          } else {
            setError(result.message);
          }
          loadBranches();
        })
        .catch((error: unknown) => {
          if (!mountedRef.current) {
            return;
          }
          setError(
            error instanceof Error ? error.message : 'The Git command failed',
          );
        })
        .finally(() => {
          if (mountedRef.current) {
            setBusy(false);
          }
        });
    },
    [loadBranches],
  );

  const diff = useCallback(
    async (path: string, staged: boolean): Promise<string | null> => {
      const result = await window.nova?.git.diff(path, staged);
      if (result === undefined || !result.ok) {
        return null;
      }
      return result.value.diff;
    },
    [],
  );

  return {
    status,
    branches,
    error,
    busy,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    diff,
    switchBranch,
  };
}
