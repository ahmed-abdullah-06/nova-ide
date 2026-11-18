/**
 * Main-process handlers for window and shell commands.
 *
 * Every operation targets the application's own window. The renderer supplies
 * no window id, no path and no command string — only a close token it received
 * from the main process.
 */
import { app, BrowserWindow, shell } from 'electron';
import type {
  FsResult,
  WindowStateSnapshot,
} from '../../shared/ipc-types';
import type { CloseFlow } from '../closeFlow';

const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 3;

function targetWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function snapshot(window: BrowserWindow | undefined): WindowStateSnapshot {
  return {
    maximized: window?.isMaximized() ?? false,
    fullScreen: window?.isFullScreen() ?? false,
  };
}

function changeZoom(window: BrowserWindow | undefined, delta: number | 'reset'): number {
  if (window === undefined || window.isDestroyed()) {
    return 0;
  }
  const current = window.webContents.getZoomLevel();
  const requested = delta === 'reset' ? 0 : current + delta;
  const level = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, requested));
  window.webContents.setZoomLevel(level);
  return window.webContents.getZoomLevel();
}

export interface WindowHandlers {
  state(): Promise<WindowStateSnapshot>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<WindowStateSnapshot>;
  toggleFullScreen(): Promise<WindowStateSnapshot>;
  close(): Promise<void>;
  confirmClose(token: string, confirmed: boolean): Promise<void>;
  zoomIn(): Promise<number>;
  zoomOut(): Promise<number>;
  zoomReset(): Promise<number>;
  quit(): Promise<void>;
  toggleDevTools(): Promise<boolean>;
  openLogsFolder(): Promise<FsResult<void>>;
}

export function createWindowHandlers(closeFlow: CloseFlow): WindowHandlers {
  return {
    async state() {
      return snapshot(targetWindow());
    },

    async minimize() {
      const window = targetWindow();
      if (window !== undefined && !window.isDestroyed()) {
        window.minimize();
      }
    },

    async toggleMaximize() {
      const window = targetWindow();
      if (window !== undefined && !window.isDestroyed()) {
        if (window.isMaximized()) {
          window.restore();
        } else {
          window.maximize();
        }
      }
      return snapshot(window);
    },

    async toggleFullScreen() {
      const window = targetWindow();
      if (window !== undefined && !window.isDestroyed()) {
        window.setFullScreen(!window.isFullScreen());
      }
      return snapshot(window);
    },

    // The close itself happens in the close-flow confirmation callback, never
    // directly from a renderer request.
    async close() {
      await closeFlow.request('close-window', targetWindow() ?? null);
    },

    async confirmClose(token, confirmed) {
      closeFlow.confirm(token, confirmed);
    },

    async zoomIn() {
      return changeZoom(targetWindow(), 1);
    },

    async zoomOut() {
      return changeZoom(targetWindow(), -1);
    },

    async zoomReset() {
      return changeZoom(targetWindow(), 'reset');
    },

    async quit() {
      await closeFlow.request('quit', targetWindow() ?? null);
    },

    async toggleDevTools() {
      const window = targetWindow();
      if (window === undefined || window.isDestroyed()) {
        return false;
      }
      window.webContents.toggleDevTools();
      return window.webContents.isDevToolsOpened();
    },

    async openLogsFolder() {
      try {
        // The path comes from Electron, never from the renderer.
        const error = await shell.openPath(app.getPath('logs'));
        if (error !== '') {
          return {
            ok: false,
            code: 'UNKNOWN',
            message: 'The logs folder could not be opened.',
          };
        }
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          code: 'UNKNOWN',
          message: 'The logs folder could not be opened.',
        };
      }
    },
  };
}
