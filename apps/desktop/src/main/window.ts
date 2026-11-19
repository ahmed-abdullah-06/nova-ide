import { BrowserWindow } from 'electron';
import path from 'node:path';
import {
  IpcPushChannels,
  type WindowStateSnapshot,
} from '../shared/ipc-types';

const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 640;

/**
 * Windows that the main process has already approved for closing. The native
 * `close` event is intercepted for every other close so unsaved work can be
 * confirmed first.
 */
const approvedCloses = new WeakSet<BrowserWindow>();

export function approveWindowClose(window: BrowserWindow): void {
  approvedCloses.add(window);
}

export interface MainWindowOptions {
  /** Called when the user clicks the native close control. */
  onNativeClose: (window: BrowserWindow) => void;
}

function getAllowedNavigationPrefixes(): string[] {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return [MAIN_WINDOW_VITE_DEV_SERVER_URL];
  }
  return ['file://'];
}

function isAllowedNavigationUrl(url: string): boolean {
  return getAllowedNavigationPrefixes().some((prefix) => url.startsWith(prefix));
}

/**
 * Creates the main application window with the hardened settings required by
 * the security specification (spec §19.1):
 *
 *  - nodeIntegration: false
 *  - contextIsolation: true
 *  - sandbox: true
 *  - no webview tag
 *  - navigation restricted to the application's own renderer
 *  - popups/new windows denied
 */
export function createMainWindow({ onNativeClose }: MainWindowOptions): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#111318',
    title: 'A6',
    // The renderer draws one title/menu row. Hide the native title bar and
    // let Windows draw the minimise/maximise/close overlay buttons on top of
    // it. The colours match the default dark theme tokens.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171a21',
      symbolColor: '#e5e7eb',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // Remove the window-level native menu as well; the renderer command menu is
  // the single source of truth for every item and accelerator.
  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Keep the renderer's toggle marks honest when state changes outside a
  // command (native maximize button, full-screen gesture, another display).
  const pushState = (): void => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    const state: WindowStateSnapshot = {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
    };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcPushChannels.windowStateChanged, state);
      }
    }
  };
  mainWindow.on('maximize', pushState);
  mainWindow.on('unmaximize', pushState);
  mainWindow.on('enter-full-screen', pushState);
  mainWindow.on('leave-full-screen', pushState);

  // Every close starts with the shared dirty check. An approved close is
  // marked above and passes straight through.
  mainWindow.on('close', (event) => {
    if (approvedCloses.has(mainWindow)) {
      approvedCloses.delete(mainWindow);
      return;
    }
    event.preventDefault();
    onNativeClose(mainWindow);
  });

  // Block any navigation away from the application renderer.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
    }
  });

  // Deny popups (window.open / target="_blank") — no renderer may spawn windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Never attach <webview> tags.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Developer tools are opened automatically in development only.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/main_window/index.html'),
    );
  }

  return mainWindow;
}
