import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc';
import { installApplicationMenu } from './menu';
import { installContentSecurityPolicy } from './security/csp';
import { createMainWindow } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.whenReady().then(() => {
  // Security measures must be in place before any renderer loads (spec §19).
  installContentSecurityPolicy();
  // The returned callback terminates every child process on quit.
  const stopChildProcesses = registerIpcHandlers();
  installApplicationMenu();
  createMainWindow();

  // macOS convention: re-create the window when the dock icon is clicked.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('will-quit', () => {
    stopChildProcesses();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
