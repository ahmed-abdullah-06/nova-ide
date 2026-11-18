import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  DuplicateCommandIdError,
  UntrustedCommandSourceError,
  UnknownCommandError,
  getCommandTrace,
} from '../../apps/desktop/src/renderer/commands/registry';
import type { CommandContext, CommandDefinition } from '../../apps/desktop/src/renderer/commands/types';

function makeContext(): CommandContext {
  const noop = vi.fn();
  const services = Object.fromEntries(
    [
      'newFile', 'openFile', 'openWorkspace', 'saveActive', 'saveAsActive',
      'saveAll', 'closeActiveTab', 'exitApp', 'undo', 'redo', 'cut', 'copy',
      'paste', 'findInFile', 'replaceInFile', 'findInWorkspace',
      'commandPalette', 'toggleExplorer', 'toggleSearch',
      'toggleSourceControl', 'toggleAiPanel', 'toggleTerminal', 'zoomIn',
      'zoomOut', 'resetZoom', 'minimizeWindow', 'toggleMaximize',
      'toggleFullScreen', 'closeWindow', 'newWindow', 'showShortcuts',
      'toggleDevTools', 'openLogsFolder', 'showAbout',
    ].map((name) => [name, noop]),
  ) as unknown as CommandContext['services'];

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
    canRedo: false,
    focus: { kind: 'other', element: null, label: 'none' },
    activity: 'explorer',
    sidebarVisible: true,
    bottomPanelVisible: false,
    bottomPanelTab: 'terminal',
    aiPanelVisible: false,
    windowState: { maximized: false, fullScreen: false },
    services,
  };
}

function cmd(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: 'a6.test',
    title: 'Test',
    category: 'File',
    run: vi.fn(),
    ...overrides,
  };
}

describe('renderer CommandRegistry', () => {
  it('registers and retrieves commands by stable id', () => {
    const registry = new CommandRegistry();
    const definition = cmd();
    registry.register(definition);
    expect(registry.has('a6.test')).toBe(true);
    expect(registry.get('a6.test')).toBe(definition);
    expect(registry.list()).toEqual([definition]);
  });

  it('throws on a duplicate id', () => {
    const registry = new CommandRegistry();
    registry.register(cmd());
    expect(() => registry.register(cmd({ title: 'Other' }))).toThrow(
      DuplicateCommandIdError,
    );
  });

  it('throws on an unknown id', () => {
    const registry = new CommandRegistry();
    expect(() => registry.get('a6.missing')).toThrow(UnknownCommandError);
  });

  it('runs a command with context and args', async () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register(cmd({ id: 'a6.file.save', run }));
    const context = makeContext();
    await registry.execute('a6.file.save', context, 'user-menu', { source: 'x' });
    expect(run).toHaveBeenCalledWith(context, { source: 'x' });
  });

  it('does not run disabled commands', async () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register(cmd({ enabled: (context) => context.activeTabId !== null, run }));
    const outcome = await registry.execute('a6.test', makeContext(), 'user-menu');
    expect(outcome).toBe('blocked');
    expect(run).not.toHaveBeenCalled();
  });

  it('uses enabled and checked context predicates', () => {
    const definition = cmd({
      enabled: (context) => context.hasWorkspace,
      checked: (context) => context.aiPanelVisible,
    });
    const context = makeContext();
    expect(definition.enabled?.(context)).toBe(true);
    expect(definition.checked?.(context)).toBe(false);
    expect(definition.checked?.({ ...context, aiPanelVisible: true })).toBe(true);
  });

  it('rejects untrusted model, voice and programmatic sources', async () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register(cmd({ run }));
    for (const source of [
      'model-output',
      'voice-transcript',
      'programmatic',
      undefined,
    ]) {
      await expect(
        registry.execute('a6.test', makeContext(), source),
      ).rejects.toThrow(UntrustedCommandSourceError);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps a bounded, read-only trace with no arguments', async () => {
    const registry = new CommandRegistry();
    registry.register(cmd({ id: 'a6.trace.test' }));
    for (let i = 0; i < 40; i += 1) {
      await registry.execute('a6.trace.test', makeContext(), 'user-keyboard', {
        secret: `do-not-record-${i}`,
      });
    }
    const trace = getCommandTrace();
    expect(trace.length).toBeLessThanOrEqual(32);
    expect(trace.at(-1)?.id).toBe('a6.trace.test');
    expect(JSON.stringify(trace)).not.toContain('do-not-record');
    expect(Object.isFrozen(trace.at(-1))).toBe(true);
    expect(() => {
      (trace as unknown as { id: string }[])[0]!.id = 'tampered';
    }).toThrow();
    expect(getCommandTrace().at(-1)?.id).toBe('a6.trace.test');
  });
});
