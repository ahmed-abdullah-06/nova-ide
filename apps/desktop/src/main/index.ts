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

/**
 * node-pty starts a small helper process on Windows to list the processes
 * of a console. The helper cannot be started in the hardened build (the
 * `RunAsNode` fuse is disabled on purpose), so its rejection is reported
 * as a warning: the process trees are terminated with `taskkill /T`
 * instead, which does not need the helper.
 */
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes('runAsNode fuse')) {
    console.warn('[main] the node-pty helper is not available:', message);
    return;
  }
  console.error('[main] unhandled rejection:', reason);
});

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

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
