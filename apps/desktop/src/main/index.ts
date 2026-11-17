import { app, BrowserWindow, dialog } from 'electron';
import started from 'electron-squirrel-startup';
import { AppSettingsStore } from './config/appSettings';
import { registerIpcHandlers } from './ipc';
import { AppLogger, installErrorHandlers } from './logging/appLogger';
import { installApplicationMenu } from './menu';
import { installContentSecurityPolicy } from './security/csp';
import { installPermissionHandlers } from './security/permissions';
import { createMainWindow } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

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
    // The returned callback terminates every child process on quit.
    const stopChildProcesses = registerIpcHandlers(appSettings);
    installApplicationMenu();
    createMainWindow();

    // macOS convention: re-create the window when the dock icon is clicked.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
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
        app.quit();
      });
    });
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
