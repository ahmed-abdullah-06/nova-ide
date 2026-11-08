import type { IpcMainInvokeEvent } from 'electron';

/**
 * Base URL the renderer is served from.
 * - Development: the Vite dev server (http://localhost:<port>)
 * - Production: the packaged index.html (file://)
 *
 * `MAIN_WINDOW_VITE_DEV_SERVER_URL` is injected by the Forge Vite plugin.
 */
function getAllowedRendererUrlPrefix(): string {
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string') {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }
  return 'file://';
}

/**
 * Validates that an IPC message originates from the application's own
 * renderer document (spec §19.2 — validate the sender).
 *
 * This is the first line of defence: even if a malicious page somehow loaded
 * in the window, it could not call our privileged handlers.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) {
    return false;
  }
  return frameUrl.startsWith(getAllowedRendererUrlPrefix());
}
