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
  return isTrustedOrigin(event.senderFrame?.url);
}

/**
 * True when the URL belongs to the application's own renderer.
 *
 * The same rule is used for the permissions of the browser: a frame of
 * another origin may never ask for the microphone (spec §19.2).
 */
export function isTrustedOrigin(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return url.startsWith(getAllowedRendererUrlPrefix());
}
