/**
 * Command runtime for the renderer.
 *
 * Owns the single registry/resolver pair, builds one context from the current
 * shell state, runs keyboard commands through a trusted source, and exposes
 * the derived menu to the UI. Feature flags are switched on as the matching
 * main-process IPC lands; disabled commands report an honest reason.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppInfo } from '../../shared/ipc-types';
import { AboutDialog, ShortcutsDialog } from '../components/layout/Dialogs';
import { useConfirm } from '../components/ui/ConfirmProvider';
import {
  editorHistoryState,
  isEditorReady,
  requestEditorAction,
} from '../features/editor/editorCommands';
import { disposeModel } from '../features/editor/modelRegistry';
import {
  CommandPaletteOverlay,
  QuickOpenOverlay,
} from '../features/palette/PaletteOverlays';
import { useFileOpener } from '../features/workspace/hooks/useFileOpener';
import { useFileOperations } from '../features/workspace/hooks/useFileOperations';
import { useWorkspaceActions } from '../features/workspace/hooks/useWorkspaceActions';
import { useTabs } from '../stores/tabs';
import { useUi } from '../stores/ui';
import { useWorkspace } from '../stores/workspace';
import { COMMAND_IDS, createCommandDefinitions } from './catalog';
import { EMPTY_FOCUS, getFocusTarget } from './focus';
import { describeKeybindings, KeybindingResolver } from './keybindings';
import { buildMenuModel, type MenuSection } from './menuModel';
import { CommandRegistry, exposeCommandTrace } from './registry';
import type {
  CommandContext,
  CommandDefinition,
  CommandFeatures,
  CommandServices,
  FocusTarget,
  Platform,
} from './types';

const DEFINITIONS: readonly CommandDefinition[] = createCommandDefinitions();
const REGISTRY = new CommandRegistry();
for (const definition of DEFINITIONS) {
  REGISTRY.register(definition);
}

/**
 * Capabilities with a real main-process channel. Remaining flags stay false
 * until their channel exists so no menu item pretends to work.
 */
const FEATURES: CommandFeatures = {
  window: true,
  edit: true,
  filePicker: true,
  logs: true,
  devTools: true,
  zoom: true,
  quit: true,
};

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return 'win32';
  }
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('mac')) {
    return 'darwin';
  }
  if (agent.includes('linux')) {
    return 'linux';
  }
  return 'win32';
}

/**
 * True while any renderer modal owns the keyboard. The quick pick, dialogs
 * and confirmations all mark themselves `aria-modal`, so the global command
 * listener never runs behind them.
 */
function modalSurfaceOpen(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.querySelector('[aria-modal="true"]') !== null;
}

export interface CommandsContextValue {
  sections: readonly MenuSection[];
  chordHint: string | null;
  /** Platform-aware shortcut for the command centre tooltip. */
  paletteShortcut: string;
  executeFromMenu: (id: string, args?: unknown) => void;
  /** Current enabled state for honest, non-clickable Welcome actions. */
  isCommandEnabled: (id: string) => boolean;
  captureMenuFocus: () => void;
  setMenuOpen: (open: boolean) => void;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }): ReactNode {
  const {
    state: tabsState,
    dispatch: tabsDispatch,
    openSettings,
    openWelcome,
  } = useTabs();
  const { state: workspaceState, dispatch: workspaceDispatch } = useWorkspace();
  const ui = useUi();
  const { confirm } = useConfirm();
  const fileOps = useFileOperations();
  const { openFile, openFromDialog } = useFileOpener();
  const { openFolder, openRecent } = useWorkspaceActions();

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const [chordHint, setChordHint] = useState<string | null>(null);
  const [menuOpen, setMenuOpenState] = useState(false);
  const [menuFocus, setMenuFocus] = useState<FocusTarget | null>(null);
  const [overlay, setOverlay] = useState<'palette' | 'quickOpen' | null>(null);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>([]);
  const platform = useMemo(detectPlatform, []);
  const resolverRef = useRef<KeybindingResolver | null>(null);
  const nova = typeof window === 'undefined' ? undefined : window.nova;
  const { setWindowState } = ui;
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;
  const overlayRef = useRef<'palette' | 'quickOpen' | null>(null);
  const focusBeforeOverlayRef = useRef<FocusTarget | null>(null);
  const elementBeforeOverlayRef = useRef<HTMLElement | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  const notify = useCallback(
    (message: string): void => {
      workspaceDispatch({ type: 'notify', kind: 'info', message });
    },
    [workspaceDispatch],
  );

  const cancelFocusRestore = useCallback(() => {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  const openOverlay = useCallback(
    (kind: 'palette' | 'quickOpen'): void => {
      if (overlayRef.current !== null) {
        return;
      }
      // A pending restoration from the previous overlay must never steal
      // focus from the input that just took over the keyboard.
      cancelFocusRestore();
      const focus = getFocusTarget();
      focusBeforeOverlayRef.current = focus;
      elementBeforeOverlayRef.current = focus.element;
      overlayRef.current = kind;
      setOverlay(kind);
    },
    [cancelFocusRestore],
  );

  const closeOverlay = useCallback((): void => {
    if (overlayRef.current === null) {
      return;
    }
    cancelFocusRestore();
    overlayRef.current = null;
    setOverlay(null);
    const element = elementBeforeOverlayRef.current;
    elementBeforeOverlayRef.current = null;
    if (element !== null && element.isConnected) {
      // Return focus after React has removed the modal surface, but only if
      // no newer overlay or confirmation owns the keyboard in the meantime.
      focusTimerRef.current = window.setTimeout(() => {
        focusTimerRef.current = null;
        if (overlayRef.current !== null || modalSurfaceOpen()) {
          return;
        }
        if (element.isConnected) {
          element.focus({ preventScroll: true });
        }
      }, 0);
    }
  }, [cancelFocusRestore]);

  useEffect(() => cancelFocusRestore, [cancelFocusRestore]);

  const cycleTab = useCallback(
    (direction: 1 | -1): void => {
      const tabs = tabsState.tabs;
      if (tabs.length < 2) {
        return;
      }
      const current = tabs.findIndex((tab) => tab.id === tabsState.activeTabId);
      const next = current === -1
        ? 0
        : (current + direction + tabs.length) % tabs.length;
      const target = tabs[next];
      if (target !== undefined) {
        tabsDispatch({ type: 'activate', id: target.id });
      }
    },
    [tabsDispatch, tabsState.activeTabId, tabsState.tabs],
  );

  const services = useMemo<CommandServices>(
    () => ({
      newFile: () => ui.requestNewFile(),
      openFile: () => {
        if (nova === undefined) {
          notify('File opening is unavailable outside A6');
          return;
        }
        return openFromDialog();
      },
      openWorkspace: () => openFolder(),
      saveActive: () => fileOps.saveActive(),
      saveAsActive: () => fileOps.saveAsActive(),
      saveAll: () => fileOps.saveAll(),
      closeActiveTab: async () => {
        const tab = tabsState.tabs.find(
          (candidate) => candidate.id === tabsState.activeTabId,
        );
        if (tab === undefined) {
          return;
        }
        if (
          !tab.isDirty ||
          (await confirm(`Close "${tab.name}"? Unsaved changes will be lost.`, {
            title: 'Unsaved changes',
            confirmLabel: 'Discard and close',
            destructive: true,
          }))
        ) {
          tabsDispatch({ type: 'close', id: tab.id });
        }
      },
      closeTabById: async (tabId) => {
        const tab = tabsState.tabs.find(
          (candidate) => candidate.id === (tabId ?? tabsState.activeTabId),
        );
        if (tab === undefined) {
          return;
        }
        if (
          !tab.isDirty ||
          (await confirm(`Close "${tab.name}"? Unsaved changes will be lost.`, {
            title: 'Unsaved changes',
            confirmLabel: 'Discard and close',
            destructive: true,
          }))
        ) {
          disposeModel(tab.id);
          tabsDispatch({ type: 'close', id: tab.id });
        }
      },
      closeOtherTabs: async (tabId) => {
        const keepId = tabId ?? tabsState.activeTabId;
        const others = tabsState.tabs.filter((tab) => tab.id !== keepId);
        if (others.length === 0) {
          return;
        }
        const dirty = others.filter((tab) => tab.isDirty);
        if (
          dirty.length > 0 &&
          !(await confirm(
            `Close ${dirty.length} tab(s) with unsaved changes?`,
            {
              title: 'Unsaved changes',
              confirmLabel: 'Discard and close',
              destructive: true,
            },
          ))
        ) {
          return;
        }
        for (const tab of others) {
          disposeModel(tab.id);
          tabsDispatch({ type: 'close', id: tab.id });
        }
      },
      closeAllTabs: async () => {
        if (tabsState.tabs.length === 0) {
          return;
        }
        const dirty = tabsState.tabs.filter((tab) => tab.isDirty);
        if (
          dirty.length > 0 &&
          !(await confirm(
            `Close ${dirty.length} tab(s) with unsaved changes?`,
            {
              title: 'Unsaved changes',
              confirmLabel: 'Discard and close',
              destructive: true,
            },
          ))
        ) {
          return;
        }
        for (const tab of tabsState.tabs) {
          disposeModel(tab.id);
          tabsDispatch({ type: 'close', id: tab.id });
        }
      },
      copyTabPath: (tabId) => {
        const tab = tabsState.tabs.find(
          (candidate) => candidate.id === (tabId ?? tabsState.activeTabId),
        );
        if (tab === undefined) {
          return;
        }
        if (tab.filePath === null) {
          notify('This buffer has no file path.');
          return;
        }
        void navigator.clipboard.writeText(tab.filePath).catch(() => {
          notify('Could not copy the path to the clipboard.');
        });
      },
      openSettings: () => {
        ui.showActivity('settings');
        openSettings();
      },
      exitApp: () =>
        nova === undefined
          ? notify('Quit is unavailable outside A6')
          : nova.system.quit(),
      // These only run for non-Monaco text fields. Monaco uses its own precise
      // actions via the catalog, not these native webContents actions.
      undo: () => nova?.edit.webContentsAction('undo'),
      redo: () => nova?.edit.webContentsAction('redo'),
      cut: () => nova?.edit.webContentsAction('cut'),
      copy: () => nova?.edit.webContentsAction('copy'),
      paste: () => nova?.edit.webContentsAction('paste'),
      findInFile: () => requestEditorAction('actions.find'),
      replaceInFile: () => requestEditorAction('editor.action.startFindReplaceAction'),
      findInWorkspace: () => ui.showActivity('search', true),
      commandPalette: () => openOverlay('palette'),
      quickOpen: () => openOverlay('quickOpen'),
      openFileByPath: (path, options) => openFile(path, options),
      openRecentWorkspace: (rootPath) => openRecent(rootPath),
      showWelcome: () => openWelcome(),
      nextTab: () => cycleTab(1),
      previousTab: () => cycleTab(-1),
      toggleExplorer: () => ui.toggleActivity('explorer'),
      toggleSidebar: () => ui.toggleSidebar(),
      toggleSearch: () => ui.toggleActivity('search'),
      toggleSourceControl: () => ui.toggleActivity('scm'),
      toggleAiPanel: () => ui.toggleAiPanel(),
      toggleTerminal: () => ui.toggleBottomPanel('terminal'),
      toggleBottomPanel: () => ui.toggleBottomPanel(ui.bottomPanelTab),
      newTerminal: () => ui.requestNewTerminal(),
      maximizeBottomPanel: () => ui.toggleBottomPanelMaximized(),
      closeBottomPanel: () => ui.hideBottomPanel(),
      zoomIn: async () => {
        await nova?.window.zoomIn();
      },
      zoomOut: async () => {
        await nova?.window.zoomOut();
      },
      resetZoom: async () => {
        await nova?.window.resetZoom();
      },
      minimizeWindow: () => nova?.window.minimize(),
      toggleMaximize: async () => {
        if (nova !== undefined) {
          setWindowState(await nova.window.toggleMaximize());
        }
      },
      toggleFullScreen: async () => {
        if (nova !== undefined) {
          setWindowState(await nova.window.toggleFullScreen());
        }
      },
      closeWindow: () =>
        nova === undefined
          ? notify('Window controls are unavailable outside A6')
          : nova.window.close(),
      newWindow: () => undefined,
      showShortcuts: () => setDialog('shortcuts'),
      toggleDevTools: async () => {
        if (nova === undefined) {
          notify('Developer tools are unavailable outside A6');
          return;
        }
        const open = await nova.system.toggleDevTools();
        notify(open ? 'Developer tools opened.' : 'Developer tools closed.');
      },
      openLogsFolder: async () => {
        if (nova === undefined) {
          notify('The logs folder is unavailable outside A6');
          return;
        }
        const result = await nova.system.openLogsFolder();
        if (!result.ok) {
          notify(result.message);
        }
      },
      showAbout: () => setDialog('about'),
    }),
    [
      confirm,
      cycleTab,
      fileOps,
      nova,
      notify,
      openFile,
      openFolder,
      openFromDialog,
      openOverlay,
      openRecent,
      openSettings,
      openWelcome,
      setWindowState,
      tabsDispatch,
      tabsState,
      ui,
    ],
  );

  const buildContext = useCallback(
    (focus: FocusTarget): CommandContext => {
      const history = editorHistoryState();
      return {
        platform,
        bridgeAvailable: typeof window !== 'undefined' && window.nova !== undefined,
        features: FEATURES,
        tabs: tabsState.tabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          isDirty: tab.isDirty,
          origin: tab.origin,
          externalGrantId: tab.externalGrantId,
          kind: tab.kind,
        })),
        activeTabId: tabsState.activeTabId,
        hasWorkspace: workspaceState.workspace !== null,
        editorReady: isEditorReady(),
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        focus,
        activity: ui.activity,
        sidebarVisible: ui.sidebarVisible,
        bottomPanelVisible: ui.bottomPanelVisible,
        bottomPanelTab: ui.bottomPanelTab,
        bottomPanelMaximized: ui.bottomPanelMaximized,
        aiPanelVisible: ui.aiPanelVisible,
        windowState: ui.windowState,
        services,
      };
    },
    [platform, services, tabsState, ui, workspaceState.workspace],
  );

  const buildContextRef = useRef(buildContext);
  buildContextRef.current = buildContext;

  const execute = useCallback(
    async (
      id: string,
      source: 'user-menu' | 'user-keyboard',
      focusOverride?: FocusTarget,
      args?: unknown,
    ): Promise<void> => {
      const context = buildContextRef.current(focusOverride ?? getFocusTarget());
      try {
        const outcome = await REGISTRY.execute(id, context, source, args);
        if (outcome === 'blocked') {
          const definition = REGISTRY.get(id);
          const reason =
            definition.disabledHint?.(context) ??
            definition.plannedHint ??
            'Not available in this build';
          notify(`${definition.title}: ${reason}`);
        } else {
          // Recent ids only affect palette ordering; they are never persisted.
          setRecentCommandIds((ids) =>
            [id, ...ids.filter((candidate) => candidate !== id)].slice(0, 10),
          );
        }
      } catch (error) {
        workspaceDispatch({
          type: 'notify',
          kind: 'error',
          message: error instanceof Error ? error.message : 'Command failed',
        });
      }
    },
    [notify, workspaceDispatch],
  );
  const executeRef = useRef(execute);
  executeRef.current = execute;

  const executeFromOverlay = useCallback(
    (id: string, args?: unknown): void => {
      // Palette selection is a trusted UI action; context-sensitive commands
      // still see the focus that was active before the overlay was opened.
      const focus = focusBeforeOverlayRef.current ?? EMPTY_FOCUS;
      closeOverlay();
      void executeRef.current(id, 'user-menu', focus, args);
    },
    [closeOverlay],
  );

  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const menuFocusRef = useRef(menuFocus);
  menuFocusRef.current = menuFocus;
  const chordHintRef = useRef(chordHint);
  chordHintRef.current = chordHint;

  // Harmless, read-only trace for packaged verification. It only exposes
  // command ids/outcomes and never accepts an argument or executes a command.
  useEffect(() => exposeCommandTrace(), []);

  // One resolver per platform. The hint is rendered in the menu bar.
  useEffect(() => {
    const resolver = new KeybindingResolver(DEFINITIONS, platform, {
      timeoutMs: 1200,
      onHint: (hint) => setChordHint(hint),
    });
    resolverRef.current = resolver;
    return () => {
      resolver.dispose();
      resolverRef.current = null;
    };
  }, [platform]);

  // All keyboard commands pass through this one trusted listener.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const resolver = resolverRef.current;
      if (resolver === null) {
        return;
      }
      if (
        menuOpenRef.current ||
        overlayRef.current !== null ||
        modalSurfaceOpen()
      ) {
        return;
      }
      if (event.key === 'Escape' && chordHintRef.current !== null) {
        resolver.cancel();
      }
      const context = buildContextRef.current(getFocusTarget());
      const result = resolver.handleKey(event, context);
      if (result.kind === 'command') {
        event.preventDefault();
        void executeRef.current(result.commandId, 'user-keyboard');
      } else if (result.kind === 'chord') {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [platform]);

  // About dialog uses real metadata from the typed preload bridge.
  useEffect(() => {
    const bridge = window.nova;
    if (!bridge) {
      return;
    }
    let cancelled = false;
    bridge.getAppInfo().then(
      (info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Window state pushes and the tokenized close handshake. The renderer only
  // reports whether unsaved work may be discarded; the main process decides
  // when to actually close or quit.
  useEffect(() => {
    if (nova === undefined) {
      return;
    }
    const unsubscribeState = nova.window.onStateChanged((state) => {
      setWindowState(state);
    });
    const unsubscribeClose = nova.window.onCloseRequest(async (request) => {
      const dirty = tabsRef.current.tabs.filter((tab) => tab.isDirty);
      let confirmed = true;
      if (dirty.length > 0) {
        const names = dirty.slice(0, 3).map((tab) => tab.name).join(', ');
        const more = dirty.length > 3 ? ` and ${dirty.length - 3} more` : '';
        confirmed = await confirm(
          `Close A6 IDE? Unsaved changes in ${names}${more} will be lost.`,
          {
            title: 'Unsaved changes',
            confirmLabel: 'Discard and quit',
            destructive: true,
          },
        );
      }
      try {
        await nova.window.confirmClose(request.token, confirmed);
      } catch {
        // The request may have expired; there is nothing left to approve.
      }
    });
    return () => {
      unsubscribeState();
      unsubscribeClose();
    };
  }, [confirm, nova, setWindowState]);

  const captureMenuFocus = useCallback((): void => {
    setMenuFocus(getFocusTarget());
  }, []);

  const setMenuOpen = useCallback((open: boolean): void => {
    setMenuOpenState(open);
    if (!open) {
      setMenuFocus(null);
    }
  }, []);

  const menuContext = buildContext(menuOpen ? (menuFocus ?? EMPTY_FOCUS) : getFocusTarget());
  const sections = buildMenuModel(DEFINITIONS, menuContext, platform);
  const overlayContext = buildContext(
    overlay === null ? EMPTY_FOCUS : (focusBeforeOverlayRef.current ?? EMPTY_FOCUS),
  );
  const isCommandEnabled = useCallback(
    (id: string): boolean => {
      const definition = DEFINITIONS.find((candidate) => candidate.id === id);
      return definition?.enabled?.(menuContext) ?? true;
    },
    [menuContext],
  );

  const paletteShortcut = useMemo(() => {
    const definition = DEFINITIONS.find(
      (candidate) => candidate.id === COMMAND_IDS.commandPalette,
    );
    return describeKeybindings(definition?.keybindings?.[platform], platform) ?? '';
  }, [platform]);

  const value = useMemo<CommandsContextValue>(
    () => ({
      sections,
      chordHint,
      paletteShortcut,
      executeFromMenu: (id: string, args?: unknown) => {
        void executeRef.current(
          id,
          'user-menu',
          menuFocusRef.current ?? undefined,
          args,
        );
      },
      isCommandEnabled,
      captureMenuFocus,
      setMenuOpen,
    }),
    [
      captureMenuFocus,
      chordHint,
      isCommandEnabled,
      paletteShortcut,
      sections,
      setMenuOpen,
    ],
  );

  return (
    <CommandsContext.Provider value={value}>
      {children}
      {dialog === 'shortcuts' ? (
        <ShortcutsDialog
          definitions={DEFINITIONS}
          platform={platform}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'about' ? (
        <AboutDialog appInfo={appInfo} onClose={() => setDialog(null)} />
      ) : null}
      {overlay === 'palette' ? (
        <CommandPaletteOverlay
          definitions={DEFINITIONS}
          context={overlayContext}
          platform={platform}
          recentIds={recentCommandIds}
          onExecute={(id) => executeFromOverlay(id)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay === 'quickOpen' ? (
        <QuickOpenOverlay
          onOpenFile={(path, options) =>
            executeFromOverlay(COMMAND_IDS.openFileByPath, { path, ...options })
          }
          onClose={closeOverlay}
        />
      ) : null}
    </CommandsContext.Provider>
  );
}

export function useCommands(): CommandsContextValue {
  const context = useContext(CommandsContext);
  if (context === null) {
    throw new Error('useCommands must be used inside <CommandProvider>');
  }
  return context;
}
