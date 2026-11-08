import { BrowserWindow } from 'electron';
import path from 'node:path';

const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 640;

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
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#111318',
    title: 'NOVA IDE',
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
