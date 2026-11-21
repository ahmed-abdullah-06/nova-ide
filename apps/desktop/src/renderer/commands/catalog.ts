/** The exact command set used by the menu, shortcuts and future palette. */
import {
  requestEditorAction,
  editorHistoryState,
} from '../features/editor/editorCommands';
import type {
  CommandContext,
  CommandDefinition,
  KeybindingSpec,
  Platform,
} from './types';

export const COMMAND_IDS = {
  newFile: 'a6.file.newFile',
  openFile: 'a6.file.openFile',
  openWorkspace: 'a6.file.openWorkspace',
  save: 'a6.file.save',
  saveAs: 'a6.file.saveAs',
  saveAll: 'a6.file.saveAll',
  closeTab: 'a6.file.closeTab',
  /** Tab context-menu actions; also reachable from the future command palette. */
  closeTabById: 'a6.tab.close',
  closeOtherTabs: 'a6.tab.closeOthers',
  closeAllTabs: 'a6.tab.closeAll',
  copyTabPath: 'a6.tab.copyPath',
  exit: 'a6.app.exit',
  undo: 'a6.edit.undo',
  redo: 'a6.edit.redo',
  cut: 'a6.edit.cut',
  copy: 'a6.edit.copy',
  paste: 'a6.edit.paste',
  findInFile: 'a6.edit.findInFile',
  replaceInFile: 'a6.edit.replaceInFile',
  findInWorkspace: 'a6.edit.findInWorkspace',
  commandPalette: 'a6.view.commandPalette',
  toggleExplorer: 'a6.view.toggleExplorer',
  toggleSearch: 'a6.view.toggleSearch',
  toggleSourceControl: 'a6.view.toggleSourceControl',
  toggleAiPanel: 'a6.view.toggleAiPanel',
  /** Registered for Ctrl+, only; deliberately absent from the menu. */
  openSettings: 'a6.view.openSettings',
  toggleTerminal: 'a6.view.toggleTerminal',
  /** Bottom-panel actions; no keybindings so LF4 layout shortcuts stay free. */
  newTerminal: 'a6.terminal.new',
  maximizeBottomPanel: 'a6.view.maximizeBottomPanel',
  closeBottomPanel: 'a6.view.closeBottomPanel',
  zoomIn: 'a6.view.zoomIn',
  zoomOut: 'a6.view.zoomOut',
  resetZoom: 'a6.view.resetZoom',
  newWindow: 'a6.window.newWindow',
  minimize: 'a6.window.minimize',
  toggleMaximize: 'a6.window.toggleMaximize',
  toggleFullScreen: 'a6.window.toggleFullScreen',
  closeWindow: 'a6.window.close',
  shortcuts: 'a6.help.shortcuts',
  toggleDevTools: 'a6.help.toggleDevTools',
  openLogsFolder: 'a6.help.openLogsFolder',
  about: 'a6.help.about',
} as const;

function primary(key: string, shift = false): KeybindingSpec {
  return { first: { key, modifiers: { primary: true, shift } } };
}

function chord(first: string, second: string): KeybindingSpec {
  return {
    first: { key: first, modifiers: { primary: true } },
    second: { key: second, modifiers: { primary: true } },
  };
}

function plain(key: string): KeybindingSpec {
  return { first: { key, modifiers: {} } };
}

function all(spec: KeybindingSpec): Record<Platform, KeybindingSpec> {
  return { win32: spec, darwin: spec, linux: spec };
}

/** Keyboard binding that must never steal a key from the integrated terminal. */
function outsideTerminal(spec: KeybindingSpec): KeybindingSpec {
  return { ...spec, when: 'notTerminalFocused' };
}

function active(context: CommandContext): boolean {
  return (
    context.activeTabId !== null &&
    activeTab(context)?.kind !== 'settings'
  );
}

function activeTab(context: CommandContext) {
  return context.tabs.find((tab) => tab.id === context.activeTabId);
}

function editable(context: CommandContext): boolean {
  return (
    context.focus.kind === 'monaco' ||
    context.focus.kind === 'input' ||
    context.focus.kind === 'contenteditable'
  );
}

function editorAction(id: string): (context: CommandContext) => void {
  return () => {
    requestEditorAction(id);
  };
}

function hint(text: string): (context: CommandContext) => string {
  return () => text;
}

const NO_TAB = 'No editor tab is active';
const NO_WORKSPACE = 'Open a folder or workspace first';
const NO_BRIDGE = 'Requires the A6 desktop bridge';
const NO_EDITOR = 'No editor is available';
const NOT_EDITABLE = 'Focus a text field or the editor first';
const PLANNED_PALETTES = 'The Command Palette is planned for a later milestone';
const PLANNED_WINDOWS = 'Multiple windows are planned for a later milestone';

/** Builds all command definitions around the actions supplied by the shell. */
export function createCommandDefinitions(): CommandDefinition[] {
  const definitions: CommandDefinition[] = [
    {
      id: COMMAND_IDS.newFile,
      title: 'New File',
      category: 'File',
      keybindings: all(primary('KeyN')),
      run: (context) => context.services.newFile(),
      enabled: (context) => context.hasWorkspace && context.bridgeAvailable,
      disabledHint: (context) => (context.hasWorkspace ? NO_BRIDGE : NO_WORKSPACE),
    },
    {
      id: COMMAND_IDS.openFile,
      title: 'Open File...',
      category: 'File',
      keybindings: all(primary('KeyO')),
      run: (context) => context.services.openFile(),
      enabled: (context) => context.bridgeAvailable && context.features.filePicker,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.openWorkspace,
      title: 'Open Folder / Workspace...',
      category: 'File',
      keybindings: all(chord('KeyK', 'KeyO')),
      run: (context) => context.services.openWorkspace(),
      enabled: (context) => context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.save,
      title: 'Save',
      category: 'File',
      keybindings: all(primary('KeyS')),
      run: (context) => context.services.saveActive(),
      enabled: active,
      disabledHint: hint(NO_TAB),
    },
    {
      id: COMMAND_IDS.saveAs,
      title: 'Save As...',
      category: 'File',
      keybindings: all(primary('KeyS', true)),
      run: (context) => context.services.saveAsActive(),
      enabled: (context) =>
        active(context) &&
        context.hasWorkspace &&
        activeTab(context)?.origin !== 'external',
      disabledHint: (context) => {
        if (!active(context)) {
          return NO_TAB;
        }
        if (activeTab(context)?.origin === 'external') {
          return 'Save As is not available for files opened outside the workspace';
        }
        return NO_WORKSPACE;
      },
    },
    {
      id: COMMAND_IDS.saveAll,
      title: 'Save All',
      category: 'File',
      run: (context) => context.services.saveAll(),
      enabled: (context) => context.tabs.some((tab) => tab.isDirty),
      disabledHint: hint('There are no unsaved changes'),
    },
    {
      id: COMMAND_IDS.closeTab,
      title: 'Close Tab',
      category: 'File',
      keybindings: all(primary('KeyW')),
      run: (context) => context.services.closeActiveTab(),
      enabled: active,
      disabledHint: hint(NO_TAB),
    },
    {
      // Context-menu Close targets the right-clicked tab, not the active one.
      // There is no separate keybinding: Ctrl+W already closes the active tab.
      id: COMMAND_IDS.closeTabById,
      title: 'Close Tab',
      category: 'File',
      run: (context, args) =>
        context.services.closeTabById(
          typeof args === 'string' ? args : undefined,
        ),
      enabled: active,
      disabledHint: hint(NO_TAB),
    },
    {
      id: COMMAND_IDS.closeOtherTabs,
      title: 'Close Other Tabs',
      category: 'File',
      // Ctrl+K is an existing chord prefix; these second keys are unused.
      keybindings: all(chord('KeyK', 'KeyX')),
      run: (context, args) =>
        context.services.closeOtherTabs(
          typeof args === 'string' ? args : undefined,
        ),
      enabled: (context) => context.tabs.length > 1,
      disabledHint: hint('Only one tab is open'),
    },
    {
      id: COMMAND_IDS.closeAllTabs,
      title: 'Close All Tabs',
      category: 'File',
      keybindings: all(chord('KeyK', 'KeyW')),
      run: (context) => context.services.closeAllTabs(),
      enabled: (context) => context.tabs.length > 0,
      disabledHint: hint(NO_TAB),
    },
    {
      id: COMMAND_IDS.copyTabPath,
      title: 'Copy Path',
      category: 'File',
      keybindings: all(chord('KeyK', 'KeyC')),
      run: (context, args) =>
        context.services.copyTabPath(
          typeof args === 'string' ? args : undefined,
        ),
      enabled: active,
      disabledHint: hint(NO_TAB),
    },
    {
      id: COMMAND_IDS.exit,
      title: 'Exit',
      category: 'File',
      // Windows shows Alt+F4 in the menu, but the app deliberately installs
      // no such shortcut; the OS owns that key combination.
      shortcutLabel: 'Alt+F4',
      run: (context) => context.services.exitApp(),
      enabled: (context) => context.features.quit && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.undo,
      title: 'Undo',
      category: 'Edit',
      keybindings: all(primary('KeyZ')),
      editorOwned: true,
      run: (context) => {
        if (context.focus.kind === 'monaco') {
          requestEditorAction('undo');
        } else {
          void context.services.undo();
        }
      },
      enabled: (context) =>
        context.focus.kind === 'monaco'
          ? context.canUndo
          : editable(context) && context.features.edit,
      disabledHint: (context) => (editable(context) ? 'Nothing to undo' : NOT_EDITABLE),
    },
    {
      id: COMMAND_IDS.redo,
      title: 'Redo',
      category: 'Edit',
      keybindings: all(primary('KeyY')),
      editorOwned: true,
      run: (context) => {
        if (context.focus.kind === 'monaco') {
          requestEditorAction('redo');
        } else {
          void context.services.redo();
        }
      },
      enabled: (context) =>
        context.focus.kind === 'monaco'
          ? context.canRedo
          : editable(context) && context.features.edit,
      disabledHint: (context) => (editable(context) ? 'Nothing to redo' : NOT_EDITABLE),
    },
    {
      id: COMMAND_IDS.cut,
      title: 'Cut',
      category: 'Edit',
      keybindings: all(primary('KeyX')),
      editorOwned: true,
      run: (context) => {
        if (context.focus.kind === 'monaco') {
          requestEditorAction('editor.action.clipboardCutAction');
        } else {
          void context.services.cut();
        }
      },
      enabled: (context) =>
        context.focus.kind === 'monaco' ||
        (editable(context) && context.features.edit),
      disabledHint: hint(NOT_EDITABLE),
    },
    {
      id: COMMAND_IDS.copy,
      title: 'Copy',
      category: 'Edit',
      keybindings: all(primary('KeyC')),
      editorOwned: true,
      run: (context) => {
        if (context.focus.kind === 'monaco') {
          requestEditorAction('editor.action.clipboardCopyAction');
        } else {
          void context.services.copy();
        }
      },
      enabled: (context) =>
        context.focus.kind === 'monaco' ||
        (editable(context) && context.features.edit),
      disabledHint: hint(NOT_EDITABLE),
    },
    {
      id: COMMAND_IDS.paste,
      title: 'Paste',
      category: 'Edit',
      keybindings: all(primary('KeyV')),
      editorOwned: true,
      run: (context) => {
        if (context.focus.kind === 'monaco') {
          requestEditorAction('editor.action.clipboardPasteAction');
        } else {
          void context.services.paste();
        }
      },
      enabled: (context) =>
        context.focus.kind === 'monaco' ||
        (editable(context) && context.features.edit),
      disabledHint: hint(NOT_EDITABLE),
    },
    {
      id: COMMAND_IDS.findInFile,
      title: 'Find in File',
      category: 'Edit',
      keybindings: all(primary('KeyF')),
      editorOwned: true,
      run: editorAction('actions.find'),
      enabled: (context) => context.editorReady && active(context),
      disabledHint: hint(NO_EDITOR),
    },
    {
      id: COMMAND_IDS.replaceInFile,
      title: 'Replace in File',
      category: 'Edit',
      keybindings: all(primary('KeyH')),
      editorOwned: true,
      run: editorAction('editor.action.startFindReplaceAction'),
      enabled: (context) => context.editorReady && active(context),
      disabledHint: hint(NO_EDITOR),
    },
    {
      id: COMMAND_IDS.findInWorkspace,
      title: 'Find in Workspace',
      category: 'Edit',
      keybindings: all(primary('KeyF', true)),
      run: (context) => context.services.findInWorkspace(),
      enabled: (context) => context.hasWorkspace && context.bridgeAvailable,
      disabledHint: (context) => (context.hasWorkspace ? NO_BRIDGE : NO_WORKSPACE),
    },
    {
      id: COMMAND_IDS.commandPalette,
      title: 'Command Palette...',
      category: 'View',
      keybindings: all(primary('KeyP', true)),
      run: (context) => context.services.commandPalette(),
      enabled: () => false,
      plannedHint: PLANNED_PALETTES,
    },
    {
      id: COMMAND_IDS.toggleExplorer,
      title: 'Toggle Explorer',
      category: 'View',
      keybindings: all(primary('KeyE', true)),
      run: (context) => context.services.toggleExplorer(),
      checked: (context) => context.sidebarVisible && context.activity === 'explorer',
    },
    {
      id: COMMAND_IDS.toggleSearch,
      title: 'Toggle Search',
      category: 'View',
      run: (context) => context.services.toggleSearch(),
      checked: (context) => context.sidebarVisible && context.activity === 'search',
    },
    {
      id: COMMAND_IDS.toggleSourceControl,
      title: 'Toggle Source Control',
      category: 'View',
      keybindings: all(primary('KeyG', true)),
      run: (context) => context.services.toggleSourceControl(),
      checked: (context) => context.sidebarVisible && context.activity === 'scm',
    },
    {
      id: COMMAND_IDS.toggleAiPanel,
      title: 'Toggle AI Panel',
      category: 'View',
      keybindings: all(outsideTerminal(primary('KeyL'))),
      run: (context) => context.services.toggleAiPanel(),
      checked: (context) => context.aiPanelVisible,
    },
    {
      id: COMMAND_IDS.openSettings,
      title: 'Open Settings',
      category: 'View',
      // The menu stays exactly as reviewed; Ctrl+, is the only entry point
      // for this command besides the gear buttons.
      keybindings: all(primary('Comma')),
      run: (context) => context.services.openSettings(),
    },
    {
      id: COMMAND_IDS.toggleTerminal,
      title: 'Toggle Terminal',
      category: 'View',
      keybindings: all(primary('Backquote')),
      run: (context) => context.services.toggleTerminal(),
      checked: (context) => context.bottomPanelVisible && context.bottomPanelTab === 'terminal',
    },
    {
      id: COMMAND_IDS.newTerminal,
      title: 'New Terminal',
      category: 'View',
      run: (context) => context.services.newTerminal(),
      enabled: (context) => context.hasWorkspace && context.bridgeAvailable,
      disabledHint: (context) => (context.hasWorkspace ? NO_BRIDGE : NO_WORKSPACE),
    },
    {
      id: COMMAND_IDS.maximizeBottomPanel,
      title: 'Maximize Panel',
      category: 'View',
      run: (context) => context.services.maximizeBottomPanel(),
      enabled: (context) => context.bottomPanelVisible,
      disabledHint: hint('Open the bottom panel first'),
      checked: (context) => context.bottomPanelMaximized,
    },
    {
      id: COMMAND_IDS.closeBottomPanel,
      title: 'Close Panel',
      category: 'View',
      run: (context) => context.services.closeBottomPanel(),
      enabled: (context) => context.bottomPanelVisible,
      disabledHint: hint('The bottom panel is already closed'),
    },
    {
      id: COMMAND_IDS.zoomIn,
      title: 'Zoom In',
      category: 'View',
      keybindings: all(primary('Equal')),
      run: (context) => context.services.zoomIn(),
      enabled: (context) => context.features.zoom && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.zoomOut,
      title: 'Zoom Out',
      category: 'View',
      keybindings: all(primary('Minus')),
      run: (context) => context.services.zoomOut(),
      enabled: (context) => context.features.zoom && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.resetZoom,
      title: 'Reset Zoom',
      category: 'View',
      keybindings: all(primary('Digit0')),
      run: (context) => context.services.resetZoom(),
      enabled: (context) => context.features.zoom && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.newWindow,
      title: 'New Window',
      category: 'Window',
      keybindings: all(primary('KeyN', true)),
      run: (context) => context.services.newWindow(),
      enabled: () => false,
      plannedHint: PLANNED_WINDOWS,
    },
    {
      id: COMMAND_IDS.minimize,
      title: 'Minimize',
      category: 'Window',
      run: (context) => context.services.minimizeWindow(),
      enabled: (context) => context.features.window && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.toggleMaximize,
      title: 'Maximize / Restore',
      category: 'Window',
      run: (context) => context.services.toggleMaximize(),
      enabled: (context) => context.features.window && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.toggleFullScreen,
      title: 'Toggle Full Screen',
      category: 'Window',
      keybindings: all(plain('F11')),
      run: (context) => context.services.toggleFullScreen(),
      enabled: (context) => context.features.window && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
      checked: (context) => context.windowState.fullScreen,
    },
    {
      id: COMMAND_IDS.closeWindow,
      title: 'Close Window',
      category: 'Window',
      keybindings: all(primary('KeyW', true)),
      run: (context) => context.services.closeWindow(),
      enabled: (context) => context.features.window && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.shortcuts,
      title: 'Keyboard Shortcuts Reference',
      category: 'Help',
      run: (context) => context.services.showShortcuts(),
    },
    {
      id: COMMAND_IDS.toggleDevTools,
      title: 'Toggle Developer Tools',
      category: 'Help',
      keybindings: all(primary('KeyI', true)),
      run: (context) => context.services.toggleDevTools(),
      enabled: (context) => context.features.devTools && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.openLogsFolder,
      title: 'Open Logs / Data Folder',
      category: 'Help',
      run: (context) => context.services.openLogsFolder(),
      enabled: (context) => context.features.logs && context.bridgeAvailable,
      disabledHint: hint(NO_BRIDGE),
    },
    {
      id: COMMAND_IDS.about,
      title: 'About A6 IDE',
      category: 'Help',
      run: (context) => context.services.showAbout(),
    },
  ];

  return definitions;
}

/** Monaco history can change without a React render, so read it on demand. */
export function refreshEditorHistory(context: CommandContext): CommandContext {
  const { canUndo, canRedo } = editorHistoryState();
  return { ...context, canUndo, canRedo };
}
