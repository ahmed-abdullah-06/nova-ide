import { describe, expect, it } from 'vitest';
import {
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from '../../apps/desktop/src/renderer/stores/workspaceReducer';
import type { Workspace } from '../../apps/desktop/src/shared/ipc-types';

const ROOT_A = 'C:\\proj\\alpha';
const ROOT_B = 'C:\\proj\\beta';

function workspace(rootPath: string): Workspace {
  return {
    id: rootPath,
    name: rootPath.slice(rootPath.lastIndexOf('\\') + 1),
    rootPath,
    lastOpenedAt: 0,
    status: 'open',
  };
}

/** Opens `rootPath` on top of the initial state. */
function openRoot(rootPath: string): WorkspaceState {
  const opening = workspaceReducer(initialWorkspaceState, {
    type: 'open-start',
  });
  return workspaceReducer(opening, {
    type: 'open-succeeded',
    workspace: workspace(rootPath),
  });
}

describe('workspaceReducer', () => {
  it('opens a workspace with only the root expanded', () => {
    const state = openRoot(ROOT_A);
    expect(state.status).toBe('ready');
    expect(state.workspace?.rootPath).toBe(ROOT_A);
    expect(state.expandedPaths).toEqual([ROOT_A]);
    expect(state.directories).toEqual({});
  });

  it('keeps expansion of the same root when re-opened, resets otherwise', () => {
    const expanded = workspaceReducer(openRoot(ROOT_A), {
      type: 'expand',
      path: `${ROOT_A}\\src`,
    });
    const same = workspaceReducer(expanded, {
      type: 'open-succeeded',
      workspace: workspace(ROOT_A),
    });
    expect(same.expandedPaths).toContain(`${ROOT_A}\\src`);

    const switched = workspaceReducer(expanded, {
      type: 'open-succeeded',
      workspace: workspace(ROOT_B),
    });
    expect(switched.expandedPaths).toEqual([ROOT_B]);
    expect(switched.selectedPath).toBeNull();
  });

  it('stores directory contents per path', () => {
    const state = workspaceReducer(openRoot(ROOT_A), {
      type: 'load-success',
      path: ROOT_A,
      entries: [{ name: 'a.ts', path: `${ROOT_A}\\a.ts`, kind: 'file' }],
      truncated: false,
    });
    expect(state.directories[ROOT_A]?.entries).toHaveLength(1);
    expect(state.directories[ROOT_A]?.loading).toBe(false);
  });

  // Regression: an in-flight read started before a workspace switch used
  // to resolve late and write an OUTSIDE_WORKSPACE failure into the NEW
  // workspace's state (visible as a phantom error row).
  it('ignores stale load results from a previous workspace', () => {
    const stale = { path: `${ROOT_A}\\src`, entries: [], truncated: false };

    // Result arrives after switching to ROOT_B.
    const afterSwitch = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-success',
      ...stale,
    });
    expect(afterSwitch.directories).toEqual({});

    // Failure arrives after switching to ROOT_B.
    const afterSwitchFailure = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-failure',
      path: `${ROOT_A}\\src`,
      message: 'Path is outside the active workspace',
    });
    expect(afterSwitchFailure.directories).toEqual({});

    // load-start for the old workspace is dropped too.
    const afterSwitchStart = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-start',
      path: `${ROOT_A}\\src`,
    });
    expect(afterSwitchStart.directories).toEqual({});

    // Everything is dropped once the workspace is closed.
    const closed = workspaceReducer(openRoot(ROOT_A), { type: 'close' });
    const afterClose = workspaceReducer(closed, {
      type: 'load-failure',
      path: ROOT_A,
      message: 'boom',
    });
    expect(afterClose.directories).toEqual({});
    expect(afterClose.status).toBe('idle');
  });

  it('accepts load results for the current workspace (root and children)', () => {
    const entries = [{ name: 'x', path: `${ROOT_B}\\x`, kind: 'file' as const }];
    const forRoot = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-success',
      path: ROOT_B,
      entries,
      truncated: false,
    });
    expect(forRoot.directories[ROOT_B]?.entries).toHaveLength(1);

    const forChild = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-failure',
      path: `${ROOT_B}\\src`,
      message: 'denied',
    });
    expect(forChild.directories[`${ROOT_B}\\src`]?.error).toBe('denied');
  });

  it('does not confuse sibling folders with a prefix match', () => {
    // `C:\proj\beta-2` must NOT be treated as part of `C:\proj\beta`.
    const state = workspaceReducer(openRoot(ROOT_B), {
      type: 'load-success',
      path: `${ROOT_B}-2`,
      entries: [],
      truncated: false,
    });
    expect(state.directories).toEqual({});
  });

  it('expands and collapses paths idempotently', () => {
    const open = openRoot(ROOT_A);
    const twice = workspaceReducer(
      workspaceReducer(open, { type: 'expand', path: `${ROOT_A}\\s` }),
      { type: 'expand', path: `${ROOT_A}\\s` },
    );
    expect(twice.expandedPaths).toHaveLength(2);

    const collapsed = workspaceReducer(twice, {
      type: 'collapse',
      path: `${ROOT_A}\\s`,
    });
    expect(collapsed.expandedPaths).toEqual([ROOT_A]);

    const collapseAgain = workspaceReducer(collapsed, {
      type: 'collapse',
      path: `${ROOT_A}\\s`,
    });
    expect(collapseAgain).toBe(collapsed);
  });

  it('refresh clears cached directories but keeps expansion', () => {
    const loaded = workspaceReducer(openRoot(ROOT_A), {
      type: 'load-success',
      path: ROOT_A,
      entries: [],
      truncated: false,
    });
    const refreshed = workspaceReducer(loaded, { type: 'refresh' });
    expect(refreshed.directories).toEqual({});
    expect(refreshed.expandedPaths).toEqual([ROOT_A]);
  });

  it('keeps only the newest notifications', () => {
    let state = openRoot(ROOT_A);
    for (let i = 0; i < 6; i += 1) {
      state = workspaceReducer(state, {
        type: 'notify',
        kind: 'error',
        message: `err-${i}`,
      });
    }
    expect(state.notifications).toHaveLength(4);
    expect(state.notifications[3]?.message).toBe('err-5');
  });

  it('never mutates the previous state', () => {
    const before = openRoot(ROOT_A);
    const snapshot = JSON.stringify(before);
    const actions: WorkspaceAction[] = [
      { type: 'expand', path: `${ROOT_A}\\s` },
      { type: 'load-start', path: ROOT_A },
      { type: 'notify', kind: 'info', message: 'hi' },
      { type: 'select', path: `${ROOT_A}\\s` },
    ];
    for (const action of actions) {
      workspaceReducer(before, action);
    }
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  // --- inline create/rename input (M2) ---

  it('tracks a single pending inline input', () => {
    const started = workspaceReducer(openRoot(ROOT_A), {
      type: 'start-input',
      input: {
        kind: 'create-file',
        parentPath: ROOT_A,
        targetPath: null,
      },
    });
    expect(started.pendingInput?.kind).toBe('create-file');

    // Starting another input replaces the previous one (only one at a time).
    const replaced = workspaceReducer(started, {
      type: 'start-input',
      input: {
        kind: 'rename',
        parentPath: ROOT_A,
        targetPath: `${ROOT_A}\\a.ts`,
      },
    });
    expect(replaced.pendingInput?.kind).toBe('rename');
    expect(replaced.pendingInput?.targetPath).toBe(`${ROOT_A}\\a.ts`);

    const cancelled = workspaceReducer(replaced, { type: 'cancel-input' });
    expect(cancelled.pendingInput).toBeNull();

    // Cancelling with nothing pending is a no-op (same reference).
    expect(workspaceReducer(cancelled, { type: 'cancel-input' })).toBe(
      cancelled,
    );
  });

  it('never leaves a pending input behind after a rename or delete', () => {
    const input = workspaceReducer(openRoot(ROOT_A), {
      type: 'start-input',
      input: { kind: 'rename', parentPath: ROOT_A, targetPath: ROOT_A },
    });
    expect(
      workspaceReducer(input, {
        type: 'path-renamed',
        path: ROOT_A,
        newPath: ROOT_B,
        isDirectory: true,
      }).pendingInput,
    ).toBeNull();
    expect(
      workspaceReducer(input, {
        type: 'path-removed',
        path: ROOT_A,
        isDirectory: true,
      }).pendingInput,
    ).toBeNull();
  });

  // --- rename/delete cache bookkeeping (M2) ---

  function loadedTree(): WorkspaceState {
    let state = workspaceReducer(openRoot(ROOT_A), {
      type: 'expand',
      path: `${ROOT_A}\\src`,
    });
    state = workspaceReducer(state, {
      type: 'load-success',
      path: ROOT_A,
      entries: [{ name: 'src', path: `${ROOT_A}\\src`, kind: 'directory' }],
      truncated: false,
    });
    state = workspaceReducer(state, {
      type: 'load-success',
      path: `${ROOT_A}\\src`,
      entries: [{ name: 'b.ts', path: `${ROOT_A}\\src\\b.ts`, kind: 'file' }],
      truncated: false,
    });
    return workspaceReducer(state, {
      type: 'select',
      path: `${ROOT_A}\\src\\b.ts`,
    });
  }

  it('path-renamed re-keys expanded/selected paths and drops stale children', () => {
    const state = workspaceReducer(loadedTree(), {
      type: 'path-renamed',
      path: `${ROOT_A}\\src`,
      newPath: `${ROOT_A}\\lib`,
      isDirectory: true,
    });
    expect(state.expandedPaths).toEqual([ROOT_A, `${ROOT_A}\\lib`]);
    expect(state.selectedPath).toBe(`${ROOT_A}\\lib\\b.ts`);
    // The renamed folder's cached listing contains old child paths → dropped.
    expect(state.directories[`${ROOT_A}\\src`]).toBeUndefined();
    expect(state.directories[`${ROOT_A}\\lib`]).toBeUndefined();
    // Unrelated cached listings survive.
    expect(state.directories[ROOT_A]).toBeDefined();
  });

  it('path-renamed with a file keeps its directory cache (parent reloads)', () => {
    const state = workspaceReducer(loadedTree(), {
      type: 'path-renamed',
      path: `${ROOT_A}\\src\\b.ts`,
      newPath: `${ROOT_A}\\src\\c.ts`,
      isDirectory: false,
    });
    expect(state.directories[`${ROOT_A}\\src`]).toBeDefined();
    expect(state.selectedPath).toBe(`${ROOT_A}\\src\\c.ts`);
  });

  it('path-removed drops the subtree, expansion, and selection', () => {
    const state = workspaceReducer(loadedTree(), {
      type: 'path-removed',
      path: `${ROOT_A}\\src`,
      isDirectory: true,
    });
    expect(state.expandedPaths).toEqual([ROOT_A]);
    expect(state.selectedPath).toBeNull();
    expect(state.directories[`${ROOT_A}\\src`]).toBeUndefined();
    expect(state.directories[ROOT_A]).toBeDefined();
  });

  it('path-removed for an unrelated path changes nothing', () => {
    const before = loadedTree();
    const after = workspaceReducer(before, {
      type: 'path-removed',
      path: `${ROOT_A}\\other`,
      isDirectory: false,
    });
    expect(after).toBe(before);
  });
});
