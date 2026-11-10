import { describe, expect, it } from 'vitest';
import {
  initialTabsState,
  tabsReducer,
  type TabsState,
} from '../../apps/desktop/src/renderer/stores/tabsReducer';

function stateWithTabs(count: number): TabsState {
  let state = initialTabsState;
  for (let i = 1; i <= count; i += 1) {
    state = tabsReducer(state, {
      type: 'open',
      id: `file-${i}`,
      name: `file-${i}.ts`,
      language: 'typescript',
      content: '',
    });
  }
  return state;
}

describe('tabsReducer', () => {
  it('opens a tab and makes it active', () => {
    const state = tabsReducer(initialTabsState, {
      type: 'open',
      id: 'a',
      name: 'a.ts',
      language: 'typescript',
      content: '',
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('a');
    expect(state.tabs[0]?.isDirty).toBe(false);
  });

  it('re-opening an existing tab focuses it without duplicating it', () => {
    const once = stateWithTabs(2);
    const twice = tabsReducer(once, {
      type: 'open',
      id: 'file-1',
      name: 'file-1.ts',
      language: 'typescript',
      content: '',
    });
    expect(twice.tabs).toHaveLength(2);
    expect(twice.activeTabId).toBe('file-1');
  });

  it('activates an existing tab', () => {
    const state = tabsReducer(stateWithTabs(3), { type: 'activate', id: 'file-2' });
    expect(state.activeTabId).toBe('file-2');
  });

  it('ignores activating a tab that does not exist', () => {
    const before = stateWithTabs(2);
    const after = tabsReducer(before, { type: 'activate', id: 'missing' });
    expect(after).toBe(before);
  });

  it('closes the active tab and activates the next neighbour', () => {
    const state = tabsReducer(stateWithTabs(3), { type: 'close', id: 'file-2' });
    expect(state.tabs.map((tab) => tab.id)).toEqual(['file-1', 'file-3']);
    expect(state.activeTabId).toBe('file-3');
  });

  it('falls back to the previous tab when the last tab is closed', () => {
    const state = tabsReducer(stateWithTabs(3), { type: 'close', id: 'file-3' });
    expect(state.activeTabId).toBe('file-2');
  });

  it('clears the active tab when the only tab is closed', () => {
    const state = tabsReducer(stateWithTabs(1), { type: 'close', id: 'file-1' });
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it('keeps the active tab when a background tab is closed', () => {
    const started = tabsReducer(stateWithTabs(3), { type: 'activate', id: 'file-3' });
    const state = tabsReducer(started, { type: 'close', id: 'file-1' });
    expect(state.activeTabId).toBe('file-3');
  });

  it('marks a tab dirty when its content changes', () => {
    const state = tabsReducer(stateWithTabs(1), {
      type: 'update-content',
      id: 'file-1',
      content: 'const x = 1;',
    });
    expect(state.tabs[0]?.isDirty).toBe(true);
    expect(state.tabs[0]?.content).toBe('const x = 1;');
  });

  it('updates the language of a tab', () => {
    const state = tabsReducer(stateWithTabs(1), {
      type: 'set-language',
      id: 'file-1',
      language: 'python',
    });
    expect(state.tabs[0]?.language).toBe('python');
  });

  it('creates uniquely numbered untitled buffers', () => {
    let state: TabsState = { ...initialTabsState, untitledCounter: 0 };
    state = tabsReducer(state, { type: 'new-untitled', language: 'plaintext' });
    state = tabsReducer(state, { type: 'new-untitled', language: 'plaintext' });
    expect(state.tabs.map((tab) => tab.name)).toEqual([
      'Untitled-1',
      'Untitled-2',
    ]);
    expect(state.untitledCounter).toBe(2);
    expect(state.activeTabId).toBe('untitled-2');
  });

  it('ignores closing a tab that does not exist', () => {
    const before = stateWithTabs(1);
    const after = tabsReducer(before, { type: 'close', id: 'missing' });
    expect(after).toBe(before);
  });

  // --- save / dirty tracking (M2) ---

  it('mark-saved clears the dirty flag and records the new mtime', () => {
    const dirty = tabsReducer(stateWithTabs(1), {
      type: 'update-content',
      id: 'file-1',
      content: 'edited',
    });
    const saved = tabsReducer(dirty, {
      type: 'mark-saved',
      id: 'file-1',
      mtimeMs: 4242,
    });
    expect(saved.tabs[0]?.isDirty).toBe(false);
    expect(saved.tabs[0]?.mtimeMs).toBe(4242);
  });

  it('mark-saved on an unknown tab returns the same state', () => {
    const before = stateWithTabs(1);
    const after = tabsReducer(before, {
      type: 'mark-saved',
      id: 'missing',
      mtimeMs: 1,
    });
    expect(after).toBe(before);
  });

  it('set-file-path binds an untitled buffer to the saved file', () => {
    const untitled = tabsReducer(initialTabsState, {
      type: 'new-untitled',
      language: 'plaintext',
    });
    const bound = tabsReducer(untitled, {
      type: 'set-file-path',
      id: 'untitled-1',
      filePath: '/w/hello.ts',
      name: 'hello.ts',
      language: 'typescript',
      mtimeMs: 99,
    });
    expect(bound.tabs[0]?.filePath).toBe('/w/hello.ts');
    expect(bound.tabs[0]?.name).toBe('hello.ts');
    expect(bound.tabs[0]?.language).toBe('typescript');
    expect(bound.tabs[0]?.mtimeMs).toBe(99);
    expect(bound.tabs[0]?.isDirty).toBe(false);
  });

  // --- external change handling (M2) ---

  it('reload-content adopts disk content on a clean buffer', () => {
    const reloaded = tabsReducer(stateWithTabs(1), {
      type: 'reload-content',
      id: 'file-1',
      content: 'from disk',
      mtimeMs: 7,
    });
    expect(reloaded.tabs[0]?.content).toBe('from disk');
    expect(reloaded.tabs[0]?.mtimeMs).toBe(7);
    expect(reloaded.tabs[0]?.isDirty).toBe(false);
  });

  it('reload-content never clobbers a dirty buffer by default', () => {
    const dirty = tabsReducer(stateWithTabs(1), {
      type: 'update-content',
      id: 'file-1',
      content: 'my edits',
    });
    const after = tabsReducer(dirty, {
      type: 'reload-content',
      id: 'file-1',
      content: 'from disk',
      mtimeMs: 7,
    });
    expect(after).toBe(dirty);
    expect(after.tabs[0]?.content).toBe('my edits');
  });

  it('reload-content with force replaces a dirty buffer after confirmation', () => {
    const dirty = tabsReducer(stateWithTabs(1), {
      type: 'update-content',
      id: 'file-1',
      content: 'my edits',
    });
    const after = tabsReducer(dirty, {
      type: 'reload-content',
      id: 'file-1',
      content: 'from disk',
      mtimeMs: 7,
      force: true,
    });
    expect(after.tabs[0]?.content).toBe('from disk');
    expect(after.tabs[0]?.isDirty).toBe(false);
  });

  // --- rename / delete bookkeeping (M2) ---

  function fileBackedState(): TabsState {
    // Start from an empty tab list (the provider's scratch buffer is
    // covered by its own test) so path assertions can be exact.
    let state: TabsState = {
      ...initialTabsState,
      tabs: [],
      activeTabId: null,
    };
    for (const p of ['/w/a.ts', '/w/src/b.ts', '/w/src/deep/c.ts']) {
      state = tabsReducer(state, {
        type: 'open',
        id: p,
        name: p.slice(p.lastIndexOf('/') + 1),
        language: 'typescript',
        content: '',
        filePath: p,
        mtimeMs: 1,
      });
    }
    return state;
  }

  it('rename-file re-keys the renamed file tab (id = path)', () => {
    const active = tabsReducer(fileBackedState(), {
      type: 'activate',
      id: '/w/a.ts',
    });
    const state = tabsReducer(active, {
      type: 'rename-file',
      path: '/w/a.ts',
      newPath: '/w/z.ts',
      isDirectory: false,
    });
    const renamed = state.tabs.find((tab) => tab.filePath === '/w/z.ts');
    expect(renamed).toBeDefined();
    expect(renamed?.id).toBe('/w/z.ts');
    expect(renamed?.name).toBe('z.ts');
    expect(state.activeTabId).toBe('/w/z.ts');
  });

  it('rename-file re-keys every tab inside a renamed folder', () => {
    const state = tabsReducer(fileBackedState(), {
      type: 'rename-file',
      path: '/w/src',
      newPath: '/w/lib',
      isDirectory: true,
    });
    expect(state.tabs.map((tab) => tab.filePath)).toEqual([
      '/w/a.ts',
      '/w/lib/b.ts',
      '/w/lib/deep/c.ts',
    ]);
    expect(state.tabs.map((tab) => tab.id)).toEqual([
      '/w/a.ts',
      '/w/lib/b.ts',
      '/w/lib/deep/c.ts',
    ]);
  });

  it('rename-file leaves unrelated tabs untouched', () => {
    const before = fileBackedState();
    const after = tabsReducer(before, {
      type: 'rename-file',
      path: '/w/nope.ts',
      newPath: '/w/other.ts',
      isDirectory: false,
    });
    expect(after).toBe(before);
  });

  it('close-by-path closes exactly the matching file tab', () => {
    const state = tabsReducer(fileBackedState(), {
      type: 'close-by-path',
      path: '/w/src/b.ts',
      isDirectory: false,
    });
    expect(state.tabs.map((tab) => tab.filePath)).toEqual([
      '/w/a.ts',
      '/w/src/deep/c.ts',
    ]);
  });

  it('close-by-path closes every tab inside a deleted folder', () => {
    let state = fileBackedState();
    state = tabsReducer(state, { type: 'activate', id: '/w/src/b.ts' });
    state = tabsReducer(state, {
      type: 'close-by-path',
      path: '/w/src',
      isDirectory: true,
    });
    expect(state.tabs.map((tab) => tab.filePath)).toEqual(['/w/a.ts']);
    // Active tab was deleted → a neighbour takes over.
    expect(state.activeTabId).toBe('/w/a.ts');
  });

  it('close-by-path keeps untitled scratch buffers', () => {
    let state = fileBackedState();
    state = tabsReducer(state, { type: 'new-untitled', language: 'plaintext' });
    state = tabsReducer(state, {
      type: 'close-by-path',
      path: '/w/src',
      isDirectory: true,
    });
    expect(state.tabs.some((tab) => tab.filePath === null)).toBe(true);
  });
});
