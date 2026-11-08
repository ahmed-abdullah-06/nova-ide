import { session } from 'electron';

/**
 * Content-Security-Policy for the renderer (spec §19.1).
 *
 * Development needs a relaxed policy because Vite injects styles and the
 * React Refresh preamble as inline scripts, and HMR uses a websocket.
 * Production uses a strict same-origin policy.
 */
function buildCsp(): string {
  const directives = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    // Monaco creates web workers from blob: URLs
    "worker-src 'self' blob:",
  ];

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    directives.push(
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: http://localhost:*",
    );
  } else {
    directives.push(
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
    );
  }

  return directives.join('; ');
}

/** Installs the renderer CSP on the default session (call before loading the window). */
export function installContentSecurityPolicy(): void {
  const csp = buildCsp();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}
