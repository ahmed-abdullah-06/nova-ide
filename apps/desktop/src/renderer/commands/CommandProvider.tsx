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
import {
  editorHistoryState,
  isEditorReady,
  requestEditorAction,
} from '../features/editor/editorCommands';
import { useFileOpener } from '../features/workspace/hooks/useFileOpener';
import { useFileOperations } from '../features/workspace/hooks/useFileOperations';
import { useWorkspaceActions } from '../features/workspace/hooks/useWorkspaceActions';
import { useTabs } from '../stores/tabs';
import { useUi } from '../stores/ui';
import { useWorkspace } from '../stores/workspace';
import { createCommandDefinitions } from './catalog';
import { EMPTY_FOCUS, getFocusTarget } from './focus';
import { KeybindingResolver } from './keybindings';
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

export interface CommandsContextValue {
  sections: readonly MenuSection[];
  chordHint: string | null;
  executeFromMenu: (id: string) => void;
  captureMenuFocus: () => void;
  setMenuOpen: (open: boolean) => void;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }): ReactNode {
  const { state: tabsState, dispatch: tabsDispatch, openSettings } = useTabs();
  const { state: workspaceState, dispatch: workspaceDispatch } = useWorkspace();
  const ui = useUi();
  const fileOps = useFileOperations();
  const { openFromDialog } = useFileOpener();
  const { openFolder } = useWorkspaceActions();

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const [chordHint, setChordHint] = useState<string | null>(null);
  const [menuOpen, setMenuOpenState] = useState(false);
  const [menuFocus, setMenuFocus] = useState<FocusTarget | null>(null);
  const platform = useMemo(detectPlatform, []);
  const resolverRef = useRef<KeybindingResolver | null>(null);
  const nova = typeof window === 'undefined' ? undefined : window.nova;
  const { setWindowState } = ui;
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;

  const notify = useCallback(
    (message: string): void => {
      workspaceDispatch({ type: 'notify', kind: 'info', message });
    },
    [workspaceDispatch],
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
      closeActiveTab: () => {
        const tab = tabsState.tabs.find((candidate) => candidate.id === tabsState.activeTabId);
        if (tab === undefined) {
          return;
        }
        if (
          !tab.isDirty ||
          window.confirm(`Close "${tab.name}"? Unsaved changes will be lost.`)
        ) {
          tabsDispatch({ type: 'close', id: tab.id });
        }
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
      commandPalette: () => undefined,
      toggleExplorer: () => ui.toggleActivity('explorer'),
      toggleSearch: () => ui.toggleActivity('search'),
      toggleSourceControl: () => ui.toggleActivity('scm'),
      toggleAiPanel: () => ui.toggleAiPanel(),
      toggleTerminal: () => ui.toggleBottomPanel('terminal'),
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
    [fileOps, nova, notify, openFolder, openFromDialog, openSettings, setWindowState, tabsDispatch, tabsState, ui],
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
    ): Promise<void> => {
      const context = buildContextRef.current(focusOverride ?? getFocusTarget());
      try {
        const outcome = await REGISTRY.execute(id, context, source);
        if (outcome === 'blocked') {
          const definition = REGISTRY.get(id);
          const reason =
            definition.disabledHint?.(context) ??
            definition.plannedHint ??
            'Not available in this build';
          notify(`${definition.title}: ${reason}`);
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
      if (event.key === 'Escape' && chordHintRef.current !== null) {
        resolver.cancel();
      }
      if (menuOpenRef.current) {
        return;
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
        confirmed = window.confirm(
          `Close A6 IDE? Unsaved changes in ${names}${more} will be lost.`,
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
  }, [nova, setWindowState]);

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

  const value = useMemo<CommandsContextValue>(
    () => ({
      sections,
      chordHint,
      executeFromMenu: (id: string) => {
        void executeRef.current(id, 'user-menu', menuFocusRef.current ?? undefined);
      },
      captureMenuFocus,
      setMenuOpen,
    }),
    [captureMenuFocus, chordHint, sections, setMenuOpen],
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
