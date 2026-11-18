import { app, BrowserWindow, dialog } from 'electron';
import started from 'electron-squirrel-startup';
import { AppSettingsStore } from './config/appSettings';
import { resolveProfilePath } from './config/profilePath';
import { CloseFlow } from './closeFlow';
import { registerIpcHandlers } from './ipc';
import { AppLogger, installErrorHandlers } from './logging/appLogger';
import { IpcPushChannels } from '../shared/ipc-types';
import { installContentSecurityPolicy } from './security/csp';
import { installPermissionHandlers } from './security/permissions';
import { approveWindowClose, createMainWindow } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The 10G rename changed the product name. Pin the userData directory back to
// the legacy name so settings, encrypted keys and conversations survive.
// This must run before ANY getPath('logs'/'userData') or store initialisation;
// an explicit --user-data-dir (the verification harness) is left untouched.
app.setPath(
  'userData',
  resolveProfilePath({
    userData: app.getPath('userData'),
    appData: app.getPath('appData'),
    appName: app.getName(),
    hasExplicitUserData: app.commandLine.hasSwitch('user-data-dir'),
  }),
);

// The log lives in Electron's logs directory. It is bounded, rotated and
// redacted; unhandled errors are written there and shown to the user as a
// safe message without any detail that could contain a secret.
const appLogger = new AppLogger({ directory: app.getPath('logs') });
installErrorHandlers({
  logger: appLogger,
  showMessage: (title, message) => {
    dialog.showErrorBox(title, message);
  },
});

// Set once a close/quit has been approved, so the follow-up `app.quit()` does
// not ask the same question twice. An unanswered request cancels the close.
let quitApproved = false;

app.whenReady().then(() => {
  // Security measures must be in place before any renderer loads (spec §19).
  installContentSecurityPolicy();
  // The microphone is only granted for the own origin, only for audio and
  // only while a recording session is open (spec §19.2).
  installPermissionHandlers();
  // The global settings are read before the window exists: the
  // local-only mode must be known before the first request (Milestone 8).
  const appSettings = new AppSettingsStore();
  void appSettings.load().then(() => {
    const closeFlow = new CloseFlow({
      sendRequest: (request) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(IpcPushChannels.closeRequest, request);
          }
        }
      },
      onConfirmed: (reason, window) => {
        quitApproved = true;
        if (reason === 'quit') {
          for (const candidate of BrowserWindow.getAllWindows()) {
            if (!candidate.isDestroyed()) {
              approveWindowClose(candidate);
              candidate.close();
            }
          }
          app.quit();
          return;
        }
        if (window !== null && !window.isDestroyed()) {
          approveWindowClose(window);
          window.close();
        }
      },
    });

    // The returned callback terminates every child process on quit.
    const stopChildProcesses = registerIpcHandlers(appSettings, closeFlow);

    // The renderer menu replaces the native application menu; keeping both
    // would register each accelerator twice.
    const openWindow = (): BrowserWindow =>
      createMainWindow({
        onNativeClose: (window) => {
          void closeFlow.request('close-window', window);
        },
      });
    openWindow();

    // macOS convention: re-create the window when the dock icon is clicked.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openWindow();
      }
    });

    // Native/app-level quit requests use the same dirty check as Exit.
    app.on('before-quit', (event) => {
      if (quitApproved || closeFlow.hasPending) {
        return;
      }
      event.preventDefault();
      void closeFlow.request(
        'quit',
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
      );
    });

    // The quit is delayed until every child process is really gone, so a
    // task or a terminal shell can never outlive the application.
    let cleanupDone = false;
    app.on('will-quit', (event) => {
      if (cleanupDone) {
        return;
      }
      event.preventDefault();
      void stopChildProcesses().finally(() => {
        cleanupDone = true;
        closeFlow.dispose();
        app.quit();
      });
    });
  });
});

// Quit when all windows are closed, except on macOS. The close was already
// confirmed at this point, so no second dirty check is needed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitApproved = true;
    app.quit();
  }
});
