/**
 * The permission handlers of the browser session (spec §19.1, §19.2).
 *
 * Electron asks the main process before it grants a permission of the
 * renderer. The handlers of this module answer that question:
 *
 *  - the microphone is granted only for the origin of the application,
 *    only for audio, and only while a recording session is open,
 *  - everything else — the camera, the screen, the notifications, the
 *    clipboard of another origin — is denied.
 *
 * The handlers are installed once, before any renderer is loaded.
 */
import { session } from 'electron';
import { recordingSessions } from '../voice/recording';

/** Installs the permission handlers (call before loading a window). */
export function installPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaTypes =
        'mediaTypes' in details && Array.isArray(details.mediaTypes)
          ? (details.mediaTypes as readonly string[])
          : undefined;
      callback(
        recordingSessions.allow(
          permission,
          details.requestingUrl,
          mediaTypes,
          'isMainFrame' in details ? details.isMainFrame : true,
        ),
      );
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      permission === 'media' && requestingOrigin !== '' &&
      recordingSessions.allow('media', requestingOrigin, ['audio'], true),
  );
}
