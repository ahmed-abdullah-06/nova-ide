/** LF2/LF3 pure-logic checks for the shell chrome and status models. */
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, createCommandDefinitions } from '../../apps/desktop/src/renderer/commands/catalog';
import {
  assertNoKeybindingConflicts,
  collectBindings,
  describeKeybindings,
} from '../../apps/desktop/src/renderer/commands/keybindings';
import type { CommandContext } from '../../apps/desktop/src/renderer/commands/types';
import { breadcrumbSegments } from '../../apps/desktop/src/renderer/features/editor/breadcrumbModel';
import {
  detectEol,
  formatCursor,
  formatIndentation,
  formatProblemCounts,
  selectNotificationHistory,
  summarizeGitStatus,
} from '../../apps/desktop/src/renderer/features/status/statusBarModel';
import type {
  GitFileChange,
  GitStatus,
} from '../../apps/desktop/src/shared/ipc-types';

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
    const bindings = collectBindings(definitions, 'win32');
    for (const id of [
      COMMAND_IDS.closeOtherTabs,
      COMMAND_IDS.closeAllTabs,
      COMMAND_IDS.copyTabPath,
    ]) {
      expect(
        bindings.some(
          (binding) =>
            binding.commandId === id && binding.spec.second !== undefined,
        ),
        id,
      ).toBe(true);
    }
  });
});

describe('look and feel: bottom-panel commands (LF3)', () => {
  const definitions = createCommandDefinitions();
  const byId = (id: string) => definitions.find((definition) => definition.id === id);
  const context = (overrides: Partial<CommandContext> = {}): CommandContext =>
    ({
      hasWorkspace: true,
      bridgeAvailable: true,
      bottomPanelVisible: true,
      bottomPanelMaximized: false,
      ...overrides,
    }) as unknown as CommandContext;

  it('registers stable ids without duplicating keyboard-only actions', () => {
    for (const id of [
      COMMAND_IDS.newTerminal,
      COMMAND_IDS.maximizeBottomPanel,
      COMMAND_IDS.closeBottomPanel,
    ]) {
      const definition = byId(id);
      expect(definition, id).toBeDefined();
      expect(definition?.keybindings, id).toBeUndefined();
    }
  });

  it('derives enabled and checked state from real UI context', () => {
    expect(byId(COMMAND_IDS.newTerminal)?.enabled?.(context())).toBe(true);
    expect(
      byId(COMMAND_IDS.newTerminal)?.enabled?.(
        context({ hasWorkspace: false }),
      ),
    ).toBe(false);
    expect(
      byId(COMMAND_IDS.maximizeBottomPanel)?.checked?.(
        context({ bottomPanelMaximized: true }),
      ),
    ).toBe(true);
    expect(
      byId(COMMAND_IDS.closeBottomPanel)?.enabled?.(
        context({ bottomPanelVisible: false }),
      ),
    ).toBe(false);
  });
});

describe('look and feel: command surface (LF4)', () => {
  const definitions = createCommandDefinitions();
  const byId = (id: string) =>
    definitions.find((definition) => definition.id === id);
  const winBindings = (id: string) =>
    collectBindings(definitions, 'win32').filter(
      (binding) => binding.commandId === id,
    );

  it('enables the palette and registers all LF4 layout/tab actions', () => {
    for (const id of [
      COMMAND_IDS.commandPalette,
      COMMAND_IDS.quickOpen,
      COMMAND_IDS.toggleSidebar,
      COMMAND_IDS.toggleBottomPanel,
      COMMAND_IDS.showWelcome,
      COMMAND_IDS.nextTab,
      COMMAND_IDS.previousTab,
      COMMAND_IDS.openFileByPath,
      COMMAND_IDS.openRecentWorkspace,
    ]) {
      expect(byId(id), id).toBeDefined();
    }
    expect(byId(COMMAND_IDS.commandPalette)?.enabled?.({
      bridgeAvailable: false,
    } as CommandContext)).toBe(true);
    expect(byId(COMMAND_IDS.openFileByPath)?.paletteHidden).toBe(true);
    expect(byId(COMMAND_IDS.openRecentWorkspace)?.paletteHidden).toBe(true);
  });

  it('uses true aliases for F1 and keeps Quick Open out of the terminal', () => {
    const labels = describeKeybindings(
      byId(COMMAND_IDS.commandPalette)?.keybindings?.win32,
      'win32',
    );
    expect(labels).toBe('Ctrl+Shift+P / F1');
    expect(
      winBindings(COMMAND_IDS.commandPalette).map(
        (binding) => binding.spec.when,
      ),
    ).toEqual(['notTerminalFocused', 'notTerminalFocused']);
    expect(
      winBindings(COMMAND_IDS.quickOpen).map(
        (binding) => binding.spec.when,
      ),
    ).toEqual(['notTerminalFocused']);
    expect(
      winBindings(COMMAND_IDS.toggleBottomPanel).map(
        (binding) => binding.spec.when,
      ),
    ).toEqual(['notTerminalFocused']);
  });

  it('keeps LF3 panel actions without keybindings', () => {
    for (const id of [
      COMMAND_IDS.newTerminal,
      COMMAND_IDS.maximizeBottomPanel,
      COMMAND_IDS.closeBottomPanel,
    ]) {
      expect(byId(id)?.keybindings, id).toBeUndefined();
    }
  });
});

describe('look and feel: status models (LF3)', () => {
  const change = (relativePath: string, staged: boolean): GitFileChange => ({
    path: `/repo/${relativePath}`,
    relativePath,
    staged,
    status: staged ? 'M' : '?',
  });
  const status = (overrides: Partial<GitStatus> = {}): GitStatus => ({
    isRepository: true,
    branch: 'main',
    upstream: 'origin/main',
    ahead: 1,
    behind: 2,
    staged: [change('staged.ts', true)],
    unstaged: [change('edited.ts', false)],
    untracked: [change('new.ts', false), change('other.ts', false)],
    ...overrides,
  });

  it('summarises branch and real change counts', () => {
    expect(summarizeGitStatus(status())).toEqual({
      branch: 'main',
      changeCount: 4,
      tooltip:
        'main · upstream origin/main · 1 ahead · 2 behind · 4 changed file(s): 1 staged, 1 unstaged, 2 untracked',
    });
  });

  it('omits the branch when git has no repository or branch', () => {
    expect(summarizeGitStatus(null)).toBeNull();
    expect(summarizeGitStatus(status({ isRepository: false }))).toBeNull();
    expect(summarizeGitStatus(status({ branch: null }))).toBeNull();
  });

  it('formats read-only cursor, indentation, encoding and EOL values', () => {
    expect(formatCursor(12, 3)).toBe('Ln 12, Col 3');
    expect(formatCursor(0, 0)).toBe('Ln 1, Col 1');
    expect(formatIndentation(2)).toBe('Spaces: 2');
    expect(detectEol('a\nb\n')).toBe('LF');
    expect(detectEol('a\r\nb\r\n')).toBe('CRLF');
  });

  it('only shows problem counts when there is something to report', () => {
    expect(formatProblemCounts(0, 0)).toBeNull();
    expect(formatProblemCounts(1, 0)).toBe('1 error');
    expect(formatProblemCounts(2, 1)).toBe('2 errors, 1 warning');
  });

  it('keeps a bounded, newest-first notification history', () => {
    const entries = [1, 2, 3, 4].map((id) => ({
      id,
      kind: 'info' as const,
      message: `message-${id}`,
    }));
    expect(selectNotificationHistory(entries, 2).map((entry) => entry.id)).toEqual([4, 3]);
    expect(selectNotificationHistory(entries, 0)).toEqual([]);
  });
});
