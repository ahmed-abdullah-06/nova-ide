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
});
