/** LF4 pure ranking checks for the command palette and Quick Open. */
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, createCommandDefinitions } from '../../apps/desktop/src/renderer/commands/catalog';
import type { CommandContext } from '../../apps/desktop/src/renderer/commands/types';
import {
  fuzzyScore,
  rankCommands,
  rankFiles,
} from '../../apps/desktop/src/renderer/features/palette/paletteModel';
import type { SearchMatch } from '../../apps/desktop/src/shared/ipc-types';

function context(): CommandContext {
  return {
    platform: 'win32',
    bridgeAvailable: true,
    features: {
      window: true,
      edit: true,
      filePicker: true,
      logs: true,
      devTools: true,
      zoom: true,
      quit: true,
    },
    tabs: [],
    activeTabId: null,
    hasWorkspace: true,
    editorReady: true,
    canUndo: false,
    canRedo: false,
    focus: { kind: 'other', element: null, label: 'No editable target' },
    activity: 'explorer',
    sidebarVisible: true,
    bottomPanelVisible: false,
    bottomPanelTab: 'terminal',
    bottomPanelMaximized: false,
    aiPanelVisible: false,
    windowState: { maximized: false, fullScreen: false },
    services: {} as CommandContext['services'],
  };
}

function file(name: string, relativePath: string): SearchMatch {
  return {
    path: `/workspace/${relativePath}`,
    relativePath,
    name,
    line: 0,
    column: 0,
    preview: '',
  };
}

describe('fuzzy ranking', () => {
  it('rewards starts, word boundaries and contiguous matches', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('q', 'does-not-match')).toBeNull();
    expect(fuzzyScore('open', 'Open File...')).toBeGreaterThan(
      fuzzyScore('open', 'Close Other Tabs') ?? 0,
    );
    expect(fuzzyScore('cf', 'copy file')).toBeGreaterThan(
      fuzzyScore('cf', 'clear formatting of a very long label') ?? 0,
    );
  });
});

describe('command palette ranking', () => {
  const definitions = createCommandDefinitions();

  it('shows enabled user commands with real shortcut labels', () => {
    const rows = rankCommands('command palette', definitions, context(), 'win32', []);
    expect(rows[0]?.id).toBe(COMMAND_IDS.commandPalette);
    expect(rows[0]?.shortcut).toBe('Ctrl+Shift+P / F1');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('hides argument-only and disabled commands', () => {
    const ids = new Set(
      rankCommands('', definitions, context(), 'win32', []).map((row) => row.id),
    );
    expect(ids.has(COMMAND_IDS.openFileByPath)).toBe(false);
    expect(ids.has(COMMAND_IDS.openRecentWorkspace)).toBe(false);
    expect(ids.has(COMMAND_IDS.closeTabById)).toBe(false);
    expect(ids.has(COMMAND_IDS.newWindow)).toBe(false);
    expect(ids.has(COMMAND_IDS.commandPalette)).toBe(true);
  });

  it('uses recent ids only as a tie-break boost', () => {
    const recent = rankCommands(
      'toggle',
      definitions,
      context(),
      'win32',
      [COMMAND_IDS.toggleBottomPanel],
    );
    const plain = rankCommands('toggle', definitions, context(), 'win32', []);
    expect(recent[0]?.id).toBe(COMMAND_IDS.toggleBottomPanel);
    expect(plain).toContainEqual(
      expect.objectContaining({ id: COMMAND_IDS.toggleBottomPanel }),
    );
  });
});

describe('Quick Open ranking', () => {
  it('ranks trusted search results by name, then relative path', () => {
    const matches = [
      file('index.js', 'dist/index.js'),
      file('app.ts', 'src/app.ts'),
      file('app.test.ts', 'src/app.test.ts'),
    ];
    const rows = rankFiles('app', matches);
    expect(rows.map((row) => row.label)).toEqual([
      'app.ts',
      'app.test.ts',
    ]);
    expect(rows[0]?.path).toBe('/workspace/src/app.ts');
  });

  it('keeps search results in a bounded list', () => {
    const matches = Array.from({ length: 80 }, (_, index) =>
      file(`file-${index}.ts`, `src/file-${index}.ts`),
    );
    expect(rankFiles('file', matches).length).toBe(50);
  });
});
