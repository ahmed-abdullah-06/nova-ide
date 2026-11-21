/**
 * Renderer command system types.
 *
 * The registry is deliberately free of Electron and React APIs: the same
 * command id is used by the menu, keyboard shortcuts and the future command
 * palette. Untrusted content never receives a trusted command source.
 */

export type Platform = 'win32' | 'darwin' | 'linux';

export type CommandCategory = 'File' | 'Edit' | 'View' | 'Window' | 'Help';

export type CommandSource = 'user-menu' | 'user-keyboard';

export type FocusKind =
  | 'monaco'
  | 'terminal'
  | 'input'
  | 'contenteditable'
  | 'other';

export interface FocusTarget {
  kind: FocusKind;
  /** The real element, when a DOM element is available. */
  element: HTMLElement | null;
  /** Short, non-sensitive label used by diagnostics. */
  label: string;
}

export interface CommandTab {
  id: string;
  name: string;
  isDirty: boolean;
  origin: 'workspace' | 'external';
  externalGrantId?: string;
  /** The Settings tab is a real editor tab but has no file buffer. */
  kind?: 'file' | 'settings';
}

export type BottomPanelTab = 'terminal' | 'problems' | 'output';

export type ActivityId =
  | 'explorer'
  | 'search'
  | 'scm'
  | 'agent'
  | 'extensions'
  | 'settings';

export interface WindowStateSnapshot {
  maximized: boolean;
  fullScreen: boolean;
}

/** Actions provided by the application shell; no raw Node/Electron access. */
export interface CommandServices {
  newFile(): void | Promise<void>;
  openFile(): void | Promise<void>;
  openWorkspace(): void | Promise<void>;
  saveActive(): void | Promise<void>;
  saveAsActive(): void | Promise<void>;
  saveAll(): void | Promise<void>;
  closeActiveTab(): void | Promise<void>;
  /** Closes the tab identified by `tabId` (or the active one). */
  closeTabById(tabId?: string): void | Promise<void>;
  /** Closes every tab except the one identified by `tabId` (or the active one). */
  closeOtherTabs(tabId?: string): void | Promise<void>;
  /** Closes all closable editor tabs. */
  closeAllTabs(): void | Promise<void>;
  /** Copies a file-backed tab's path to the clipboard. */
  copyTabPath(tabId?: string): void | Promise<void>;
  /** Opens the Settings editor tab (Ctrl+,). Not exposed in the menu. */
  openSettings(): void | Promise<void>;
  exitApp(): void | Promise<void>;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  cut(): void | Promise<void>;
  copy(): void | Promise<void>;
  paste(): void | Promise<void>;
  findInFile(): void | Promise<void>;
  replaceInFile(): void | Promise<void>;
  findInWorkspace(): void | Promise<void>;
  commandPalette(): void | Promise<void>;
  toggleExplorer(): void | Promise<void>;
  toggleSearch(): void | Promise<void>;
  toggleSourceControl(): void | Promise<void>;
  toggleAiPanel(): void | Promise<void>;
  toggleTerminal(): void | Promise<void>;
  /** Creates a real terminal session in the mounted terminal panel. */
  newTerminal(): void | Promise<void>;
  /** Maximises/restores the bottom panel without hiding the editor model. */
  maximizeBottomPanel(): void | Promise<void>;
  /** Hides the bottom panel (the session stays mounted). */
  closeBottomPanel(): void | Promise<void>;
  zoomIn(): void | Promise<void>;
  zoomOut(): void | Promise<void>;
  resetZoom(): void | Promise<void>;
  minimizeWindow(): void | Promise<void>;
  toggleMaximize(): void | Promise<void>;
  toggleFullScreen(): void | Promise<void>;
  closeWindow(): void | Promise<void>;
  newWindow(): void | Promise<void>;
  showShortcuts(): void | Promise<void>;
  toggleDevTools(): void | Promise<void>;
  openLogsFolder(): void | Promise<void>;
  showAbout(): void | Promise<void>;
}

export interface CommandFeatures {
  window: boolean;
  edit: boolean;
  filePicker: boolean;
  logs: boolean;
  devTools: boolean;
  zoom: boolean;
  quit: boolean;
}

export interface CommandContext {
  platform: Platform;
  bridgeAvailable: boolean;
  features: CommandFeatures;
  tabs: readonly CommandTab[];
  activeTabId: string | null;
  hasWorkspace: boolean;
  editorReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Target of the current key event or the element focused before a menu opened. */
  focus: FocusTarget;
  activity: ActivityId;
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  bottomPanelTab: BottomPanelTab;
  bottomPanelMaximized: boolean;
  aiPanelVisible: boolean;
  windowState: WindowStateSnapshot;
  services: CommandServices;
}

export type ModifierName = 'primary' | 'ctrl' | 'meta' | 'shift' | 'alt';

export type ModifierSet = Partial<Record<ModifierName, boolean>>;

export interface KeyPart {
  /** Canonical key name from `KeyboardEvent.code` (for example `KeyK`). */
  key: string;
  modifiers: ModifierSet;
}

export type KeybindingWhen =
  | 'always'
  | 'monacoFocused'
  | 'notMonacoFocused'
  | 'notTerminalFocused';

export interface KeybindingSpec {
  first: KeyPart;
  /** Present for two-part chords such as Ctrl+K then Ctrl+O. */
  second?: KeyPart;
  when?: KeybindingWhen;
}

export interface CommandDefinition {
  id: string;
  title: string;
  category: CommandCategory;
  run(context: CommandContext, args?: unknown): void | Promise<void>;
  enabled?(context: CommandContext): boolean;
  checked?(context: CommandContext): boolean;
  keybindings?: Partial<Record<Platform, KeybindingSpec | null>>;
  /** Display-only accelerator label; it never installs a keybinding. */
  shortcutLabel?: string;
  /** Monaco handles these keys itself while it has focus. */
  editorOwned?: boolean;
  /** Disabled item with an honest explanation. */
  plannedHint?: string;
  /** Reason shown when `enabled(context)` is false. */
  disabledHint?(context: CommandContext): string;
}
