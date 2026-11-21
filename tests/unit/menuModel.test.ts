import { describe, expect, it } from 'vitest';
import { createCommandDefinitions, COMMAND_IDS } from '../../apps/desktop/src/renderer/commands/catalog';
import { buildMenuModel, MENU_CATEGORIES } from '../../apps/desktop/src/renderer/commands/menuModel';
import type {
  CommandContext,
  CommandDefinition,
  CommandServices,
} from '../../apps/desktop/src/renderer/commands/types';

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
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
    tabs: [{ id: 'f', name: 'f', isDirty: false, origin: 'workspace' }],
    activeTabId: 'f',
    hasWorkspace: true,
    editorReady: true,
    canUndo: true,
    canRedo: false,
    focus: { kind: 'monaco', element: null, label: 'Editor' },
    activity: 'explorer',
    sidebarVisible: true,
    bottomPanelVisible: false,
    bottomPanelTab: 'terminal',
    bottomPanelMaximized: false,
    aiPanelVisible: false,
    windowState: { maximized: false, fullScreen: false },
    services: {} as CommandServices,
    ...overrides,
  };
}

const definitions = createCommandDefinitions();

function labels(category: (typeof MENU_CATEGORIES)[number]): (string | null)[] {
  const model = buildMenuModel(definitions, makeContext(), 'win32');
  return model
    .find((section) => section.category === category)!
    .entries.map((entry) => (entry.kind === 'item' ? entry.label : null));
}

describe('menu model', () => {
  it('preserves the exact menu content and separators', () => {
    expect(labels('File')).toEqual([
      'New File',
      'Open File...',
      'Open Folder / Workspace...',
      'Quick Open...',
      null,
      'Save',
      'Save As...',
      'Save All',
      null,
      'Close Tab',
      'Exit',
    ]);
    expect(labels('Edit')).toEqual([
      'Undo',
      'Redo',
      null,
      'Cut',
      'Copy',
      'Paste',
      null,
      'Find in File',
      'Replace in File',
      'Find in Workspace',
    ]);
    expect(labels('View')).toEqual([
      'Command Palette...',
      null,
      'Toggle Explorer',
      'Toggle Search',
      'Toggle Source Control',
      'Toggle AI Panel',
      'Toggle Terminal',
      null,
      'Zoom In',
      'Zoom Out',
      'Reset Zoom',
    ]);
    expect(labels('Window')).toEqual([
      'New Window',
      'Minimize',
      'Maximize / Restore',
      'Toggle Full Screen',
      'Close Window',
    ]);
    expect(labels('Help')).toEqual([
      'Keyboard Shortcuts Reference',
      'Toggle Developer Tools',
      'Open Logs / Data Folder',
      null,
      'About A6 IDE',
    ]);
  });

  it('derives shortcut labels from keybindings (no hardcoded strings)', () => {
    const model = buildMenuModel(definitions, makeContext(), 'win32');
    const find = (id: string, sectionIndex: number) =>
      model[sectionIndex]!.entries.find(
        (entry) => entry.kind === 'item' && entry.id === id,
      );
    expect(find(COMMAND_IDS.openWorkspace, 0)).toMatchObject({
      shortcut: 'Ctrl+K Ctrl+O',
    });
    expect(find(COMMAND_IDS.quickOpen, 0)).toMatchObject({ shortcut: 'Ctrl+P' });
    expect(find(COMMAND_IDS.commandPalette, 2)).toMatchObject({
      shortcut: 'Ctrl+Shift+P / F1',
    });
    expect(find(COMMAND_IDS.toggleTerminal, 2)).toMatchObject({
      shortcut: 'Ctrl+`',
    });
    expect(find(COMMAND_IDS.zoomIn, 2)).toMatchObject({ shortcut: 'Ctrl+=' });
    // Exit shows the OS accelerator as a label only; no keybinding is installed.
    expect(find(COMMAND_IDS.exit, 0)).toMatchObject({ shortcut: 'Alt+F4' });
    expect(find(COMMAND_IDS.toggleSearch, 2)).toMatchObject({ shortcut: null });
  });

  it('uses Cmd labels on macOS', () => {
    const model = buildMenuModel(definitions, makeContext({ platform: 'darwin' }), 'darwin');
    const item = model[0]!.entries[0];
    expect(item).toMatchObject({ shortcut: 'Cmd+N' });
  });

  it('marks toggles with checked state and disabled items with honest reasons', () => {
    const model = buildMenuModel(definitions, makeContext(), 'win32');
    const byId = (id: string) =>
      model.flatMap((section) => section.entries).find(
        (entry) => entry.kind === 'item' && entry.id === id,
      );
    expect(byId(COMMAND_IDS.toggleExplorer)).toMatchObject({ checked: true });
    expect(byId(COMMAND_IDS.toggleAiPanel)).toMatchObject({ checked: false });
    expect(byId(COMMAND_IDS.save)).toMatchObject({ checked: null });
    expect(byId(COMMAND_IDS.commandPalette)).toMatchObject({
      enabled: true,
      shortcut: 'Ctrl+Shift+P / F1',
    });
    expect(byId(COMMAND_IDS.newWindow)).toMatchObject({ enabled: false });
  });

  it('disables Save As for granted external tabs with a clear reason', () => {
    const model = buildMenuModel(
      definitions,
      makeContext({
        tabs: [
          {
            id: '/outside/note.txt',
            name: 'note.txt',
            isDirty: true,
            origin: 'external',
            externalGrantId: 'grant-1',
          },
        ],
        activeTabId: '/outside/note.txt',
      }),
      'win32',
    );
    const item = model
      .flatMap((section) => section.entries)
      .find(
        (entry) => entry.kind === 'item' && entry.id === COMMAND_IDS.saveAs,
      );
    expect(item).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining('outside the workspace') as string,
    });
    // Save and Save All still work through the grant.
    const byId = (id: string) =>
      model.flatMap((section) => section.entries).find(
        (entry) => entry.kind === 'item' && entry.id === id,
      );
    expect(byId(COMMAND_IDS.save)).toMatchObject({ enabled: true });
    expect(byId(COMMAND_IDS.saveAll)).toMatchObject({ enabled: true });
  });

  it('respects focus, workspace and feature flags for enabled state', () => {
    const context = makeContext({
      hasWorkspace: false,
      activeTabId: null,
      focus: { kind: 'other', element: null, label: 'No editable target' },
      features: {
        window: false,
        edit: false,
        filePicker: false,
        logs: false,
        devTools: false,
        zoom: false,
        quit: false,
      },
    });
    const model = buildMenuModel(definitions, context, 'win32');
    const byId = (id: string) =>
      model.flatMap((section) => section.entries).find(
        (entry) => entry.kind === 'item' && entry.id === id,
      );
    expect(byId(COMMAND_IDS.newFile)).toMatchObject({ enabled: false });
    expect(byId(COMMAND_IDS.save)).toMatchObject({ enabled: false });
    expect(byId(COMMAND_IDS.undo)).toMatchObject({ enabled: false });
    expect(byId(COMMAND_IDS.minimize)).toMatchObject({ enabled: false });
    expect(byId(COMMAND_IDS.zoomIn)).toMatchObject({ enabled: false });
    // Context actions remain enabled even with no bridge features.
    expect(byId(COMMAND_IDS.toggleExplorer)).toMatchObject({ enabled: true });
    expect(byId(COMMAND_IDS.shortcuts)).toMatchObject({ enabled: true });
  });

  it('throws when a menu id has no definition', () => {
    const partial = definitions.filter((definition) => definition.id !== COMMAND_IDS.about);
    expect(() => buildMenuModel(partial, makeContext(), 'win32')).toThrow(
      /unknown command/i,
    );
  });

  it('routes every menu item through a registered command id', () => {
    const ids = new Set<string>(definitions.map((definition: CommandDefinition) => definition.id));
    const model = buildMenuModel(definitions, makeContext(), 'win32');
    for (const section of model) {
      for (const entry of section.entries) {
        if (entry.kind === 'item') {
          expect(ids.has(entry.id)).toBe(true);
        }
      }
    }
  });
});
