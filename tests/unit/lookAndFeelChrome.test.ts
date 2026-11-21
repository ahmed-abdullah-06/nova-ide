/** LF2 pure-logic checks for breadcrumbs and the new shell commands. */
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, createCommandDefinitions } from '../../apps/desktop/src/renderer/commands/catalog';
import { assertNoKeybindingConflicts } from '../../apps/desktop/src/renderer/commands/keybindings';
import { breadcrumbSegments } from '../../apps/desktop/src/renderer/features/editor/breadcrumbModel';

describe('look and feel: breadcrumbs (LF2)', () => {
  it('uses the workspace name and relative segments for a workspace file', () => {
    expect(
      breadcrumbSegments(
        'D:\\work\\demo\\src\\App.tsx',
        'D:\\work\\demo',
        'App.tsx',
      ),
    ).toEqual([
      { label: 'demo', path: null },
      { label: 'src', path: 'D:/work/demo/src' },
      { label: 'App.tsx', path: 'D:/work/demo/src/App.tsx' },
    ]);
  });

  it('keeps the full path for an external file', () => {
    const crumbs = breadcrumbSegments(
      'C:/tmp/notes.txt',
      'D:/work/demo',
      'notes.txt',
    );
    expect(crumbs[0]).toEqual({ label: 'C:', path: 'C:' });
    expect(crumbs.at(-1)?.label).toBe('notes.txt');
  });

  it('falls back to the tab name for untitled buffers', () => {
    expect(breadcrumbSegments(null, 'D:/work/demo', 'Untitled-1')).toEqual([
      { label: 'Untitled-1', path: null },
    ]);
  });
});

describe('look and feel: chrome commands (LF2)', () => {
  const definitions = createCommandDefinitions();

  it('registers the tab context actions with stable ids', () => {
    const ids = new Set(definitions.map((definition) => definition.id));
    expect(ids.has(COMMAND_IDS.closeTabById)).toBe(true);
    expect(ids.has(COMMAND_IDS.closeOtherTabs)).toBe(true);
    expect(ids.has(COMMAND_IDS.closeAllTabs)).toBe(true);
    expect(ids.has(COMMAND_IDS.copyTabPath)).toBe(true);
  });

  it('keeps every registered keybinding unique across platforms', () => {
    expect(() => assertNoKeybindingConflicts(definitions)).not.toThrow();
  });

  it('gives each new tab action a complete keybinding', () => {
    for (const id of [
      COMMAND_IDS.closeOtherTabs,
      COMMAND_IDS.closeAllTabs,
      COMMAND_IDS.copyTabPath,
    ]) {
      const definition = definitions.find((candidate) => candidate.id === id);
      expect(definition?.keybindings?.win32?.second, id).toBeDefined();
    }
  });
});
