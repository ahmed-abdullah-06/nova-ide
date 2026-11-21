import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_IDS, createCommandDefinitions } from '../../apps/desktop/src/renderer/commands/catalog';
import {
  KeybindingResolver,
  assertNoKeybindingConflicts,
  describeKeybinding,
  eventToKeyPart,
  type KeyEventLike,
} from '../../apps/desktop/src/renderer/commands/keybindings';
import type {
  CommandContext,
  CommandDefinition,
  CommandServices,
  KeybindingSpec,
} from '../../apps/desktop/src/renderer/commands/types';

function context(overrides: Partial<CommandContext> = {}): CommandContext {
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
    canUndo: true,
    canRedo: true,
    focus: { kind: 'other', element: null, label: 'none' },
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

function event(code: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    code,
    key: code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

function command(
  id: string,
  keybindings: CommandDefinition['keybindings'],
  editorOwned = false,
): CommandDefinition {
  return {
    id,
    title: id,
    category: 'File',
    run: () => undefined,
    keybindings,
    editorOwned,
  };
}

function primary(key: string, shift = false): KeybindingSpec {
  return { first: { key, modifiers: { primary: true, shift } } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('keybinding resolver', () => {
  it('normalizes event.code and derives platform display labels', () => {
    expect(eventToKeyPart(event('KeyK')).key).toBe('k');
    expect(eventToKeyPart(event('Backquote')).key).toBe('`');
    expect(eventToKeyPart(event('Equal')).key).toBe('=');
    const chord: KeybindingSpec = {
      first: { key: 'KeyK', modifiers: { primary: true } },
      second: { key: 'KeyO', modifiers: { primary: true } },
    };
    expect(describeKeybinding(chord, 'win32')).toBe('Ctrl+K Ctrl+O');
    expect(describeKeybinding(chord, 'darwin')).toBe('Cmd+K Cmd+O');
    expect(
      describeKeybinding({ first: { key: 'F11', modifiers: {} } }, 'linux'),
    ).toBe('F11');
  });

  it('resolves single keys on Windows, Linux and macOS', () => {
    const definitions = [
      command('a6.file.save', {
        win32: primary('KeyS'),
        linux: primary('KeyS'),
        darwin: primary('KeyS'),
      }),
    ];
    for (const platform of ['win32', 'linux'] as const) {
      const resolver = new KeybindingResolver(definitions, platform);
      expect(resolver.handleKey(event('KeyS', { ctrlKey: true }), context({ platform }))).toEqual({
        kind: 'command',
        commandId: 'a6.file.save',
      });
      resolver.dispose();
    }
    const mac = new KeybindingResolver(definitions, 'darwin');
    expect(
      mac.handleKey(event('KeyS', { metaKey: true }), context({ platform: 'darwin' })),
    ).toEqual({ kind: 'command', commandId: 'a6.file.save' });
    mac.dispose();
  });

  it('resolves every alias of one command without treating it as a conflict', () => {
    const aliases = [
      primary('KeyP', true),
      { first: { key: 'F1', modifiers: {} } },
    ] as const;
    const definitions = [command('a6.view.commandPalette', { win32: aliases })];
    expect(() => assertNoKeybindingConflicts(definitions)).not.toThrow();
    const resolver = new KeybindingResolver(definitions, 'win32');
    expect(
      resolver.handleKey(
        event('KeyP', { ctrlKey: true, shiftKey: true }),
        context(),
      ),
    ).toEqual({ kind: 'command', commandId: 'a6.view.commandPalette' });
    expect(resolver.handleKey(event('F1'), context())).toEqual({
      kind: 'command',
      commandId: 'a6.view.commandPalette',
    });
    resolver.dispose();
  });

  it('resolves the LF4 layout and tab shortcuts from the real catalog', () => {
    const resolver = new KeybindingResolver(createCommandDefinitions(), 'win32');
    const cases = [
      ['KeyP', { ctrlKey: true }, COMMAND_IDS.quickOpen],
      ['KeyB', { ctrlKey: true }, COMMAND_IDS.toggleSidebar],
      ['KeyJ', { ctrlKey: true }, COMMAND_IDS.toggleBottomPanel],
      ['Tab', { ctrlKey: true }, COMMAND_IDS.nextTab],
      ['PageUp', { ctrlKey: true }, COMMAND_IDS.nextTab],
      ['PageDown', { ctrlKey: true }, COMMAND_IDS.previousTab],
    ] as const;
    for (const [code, modifiers, id] of cases) {
      expect(resolver.handleKey(event(code, modifiers), context())).toEqual({
        kind: 'command',
        commandId: id,
      });
    }
    resolver.dispose();
  });

  it('resolves chords and exposes a visible hint', () => {
    const resolver = new KeybindingResolver(
      [command('a6.file.openWorkspace', { win32: {
        first: { key: 'KeyK', modifiers: { primary: true } },
        second: { key: 'KeyO', modifiers: { primary: true } },
      } })],
      'win32',
    );
    const first = resolver.handleKey(event('KeyK', { ctrlKey: true }), context());
    expect(first.kind).toBe('chord');
    expect(first).toMatchObject({ hint: 'Ctrl+K… then Ctrl+O' });
    const second = resolver.handleKey(event('KeyO', { ctrlKey: true }), context());
    expect(second).toEqual({ kind: 'command', commandId: 'a6.file.openWorkspace' });
    resolver.dispose();
  });

  it('clears a pending chord after the short timeout', () => {
    vi.useFakeTimers();
    const onHint = vi.fn();
    const resolver = new KeybindingResolver(
      [command('a6.file.openWorkspace', { win32: {
        first: { key: 'KeyK', modifiers: { primary: true } },
        second: { key: 'KeyO', modifiers: { primary: true } },
      } })],
      'win32',
      { timeoutMs: 1000, onHint },
    );
    expect(resolver.handleKey(event('KeyK', { ctrlKey: true }), context()).kind).toBe('chord');
    vi.advanceTimersByTime(1000);
    expect(onHint).toHaveBeenLastCalledWith(null);
    expect(resolver.handleKey(event('KeyO', { ctrlKey: true }), context())).toEqual({ kind: 'none' });
    resolver.dispose();
  });

  it('rejects duplicate keys in the same context and allows different contexts', () => {
    const shared = primary('KeyF');
    expect(() =>
      assertNoKeybindingConflicts([
        command('a6.edit.findInFile', { win32: shared }),
        command('a6.other', { win32: shared }),
      ]),
    ).toThrow(/Duplicate keybinding/);

    expect(() =>
      assertNoKeybindingConflicts([
        command('a6.edit.findInFile', { win32: { ...shared, when: 'monacoFocused' } }),
        command('a6.other', { win32: { ...shared, when: 'notMonacoFocused' } }),
      ]),
    ).not.toThrow();
  });

  it('lets Monaco own Ctrl+F/Ctrl+H/Ctrl+Z/Ctrl+Y while focused', () => {
    const definitions = ['KeyF', 'KeyH', 'KeyZ', 'KeyY'].map((key) =>
      command(`a6.editor.${key}`, { win32: primary(key) }, true),
    );
    const resolver = new KeybindingResolver(definitions, 'win32');
    for (const key of ['KeyF', 'KeyH', 'KeyZ', 'KeyY']) {
      expect(
        resolver.handleKey(
          event(key, { ctrlKey: true }),
          context({ focus: { kind: 'monaco', element: null, label: 'editor' } }),
        ),
      ).toEqual({ kind: 'passthrough' });
    }
    resolver.dispose();
  });

  it('passes terminal-owned keys through, including the Ctrl+K chord prefix', () => {
    const definitions = [
      command('a6.view.toggleAiPanel', { win32: primary('KeyL') }),
      command('a6.window.close', { win32: primary('KeyW') }),
      command('a6.file.openWorkspace', { win32: {
        first: { key: 'KeyK', modifiers: { primary: true } },
        second: { key: 'KeyO', modifiers: { primary: true } },
      } }),
      command('a6.edit.undo', { win32: primary('KeyZ') }),
      command('a6.edit.copy', { win32: primary('KeyC') }),
      command('a6.edit.paste', { win32: primary('KeyV') }),
    ];
    const resolver = new KeybindingResolver(definitions, 'win32');
    const terminal = context({ focus: { kind: 'terminal', element: null, label: 'terminal' } });
    for (const code of [
      'KeyB', 'KeyJ', 'KeyL', 'KeyP', 'KeyW', 'KeyK', 'KeyZ', 'KeyC', 'KeyV',
    ]) {
      expect(resolver.handleKey(event(code, { ctrlKey: true }), terminal)).toEqual({
        kind: 'passthrough',
      });
    }
    expect(resolver.handleKey(event('KeyO', { ctrlKey: true }), terminal)).toEqual({ kind: 'none' });
    resolver.dispose();
  });

  it('fires the AI panel shortcut outside the terminal', () => {
    const resolver = new KeybindingResolver(
      [command('a6.view.toggleAiPanel', { win32: primary('KeyL') })],
      'win32',
    );
    expect(resolver.handleKey(event('KeyL', { ctrlKey: true }), context())).toEqual({
      kind: 'command',
      commandId: 'a6.view.toggleAiPanel',
    });
    resolver.dispose();
  });

  it('keeps the real Ctrl+L binding out of the terminal', () => {
    const resolver = new KeybindingResolver(createCommandDefinitions(), 'win32');
    const terminal = context({
      focus: { kind: 'terminal', element: null, label: 'Terminal' },
    });
    expect(resolver.handleKey(event('KeyL', { ctrlKey: true }), terminal)).toEqual({
      kind: 'passthrough',
    });
    expect(resolver.handleKey(event('KeyL', { ctrlKey: true }), context())).toEqual({
      kind: 'command',
      commandId: COMMAND_IDS.toggleAiPanel,
    });
    resolver.dispose();
  });

  it('never installs an Alt+F4 keybinding', () => {
    const resolver = new KeybindingResolver(createCommandDefinitions(), 'win32');
    expect(
      resolver.handleKey(event('F4', { altKey: true }), context()),
    ).toEqual({ kind: 'none' });
    resolver.dispose();
  });
});
