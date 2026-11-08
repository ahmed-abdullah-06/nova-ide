import { app } from 'electron';
import type { AppInfo } from '../../shared/ipc-types';

/** Returns basic application and runtime information (no secrets, spec §19.5). */
export function createAppInfoHandler(): () => Promise<AppInfo> {
  return async (): Promise<AppInfo> => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node ?? 'unknown',
  });
}
