/**
 * The permission of the microphone (spec §19.1, §19.2).
 *
 * The microphone of the machine is a privilege that the application
 * only uses after the user asked for it. The rules are:
 *
 *  - only the `media` permission is ever granted, and only for audio
 *    (a camera is refused),
 *  - only for the origin of the application itself,
 *  - only while a recording session is open — the session is opened by
 *    the renderer when the user presses the microphone button, and it is
 *    closed when the recording ends,
 *  - everything else is denied.
 *
 * The sessions live in the main process, so the rule cannot be bypassed
 * by the renderer.
 */
import { randomBytes } from 'node:crypto';
import { isTrustedOrigin } from '../security/sender';

/** How long a session may stay open (milliseconds). */
export const SESSION_TTL_MS = 5 * 60 * 1000;

/** One open recording session. */
export interface RecordingSession {
  /** The id of the session. */
  sessionId: string;
  /** When the session was opened. */
  openedAt: number;
}

/**
 * The recording sessions of the application.
 *
 * The class holds the sessions and decides whether a permission request
 * may be granted. It has no dependency on Electron, so the rules can be
 * tested without a running application.
 */
export class RecordingSessions {
  private readonly sessions = new Map<string, RecordingSession>();

  /** Opens a session and returns its id. */
  open(): string {
    this.expire();
    const sessionId = `mic-${randomBytes(8).toString('hex')}`;
    this.sessions.set(sessionId, { sessionId, openedAt: Date.now() });
    return sessionId;
  }

  /** Closes a session (a session that does not exist is ignored). */
  close(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Closes every session (the application quits). */
  closeAll(): void {
    this.sessions.clear();
  }

  /** True when the session is still open. */
  isOpen(sessionId: string): boolean {
    this.expire();
    return this.sessions.has(sessionId);
  }

  /** True when at least one session is open. */
  hasOpenSession(): boolean {
    this.expire();
    return this.sessions.size > 0;
  }

  /** The number of the open sessions. */
  get count(): number {
    this.expire();
    return this.sessions.size;
  }

  /**
   * Decides whether a permission request may be granted.
   *
   * @param permission The permission that is requested ("media", …).
   * @param requestingUrl The URL of the frame that asks.
   * @param mediaTypes The media the frame asks for ("audio", "video").
   * @param isMainFrame False when a subframe asks.
   * @returns True when the request may be granted.
   */
  allow(
    permission: string,
    requestingUrl: string | undefined,
    mediaTypes: readonly string[] | undefined,
    isMainFrame: boolean | undefined,
  ): boolean {
    if (permission !== 'media') {
      return false;
    }
    if (isMainFrame === false) {
      return false;
    }
    if (!isTrustedOrigin(requestingUrl)) {
      return false;
    }
    const types = mediaTypes ?? [];
    if (types.length === 0) {
      // A request without a media type is refused: the application only
      // ever asks for the microphone.
      return false;
    }
    if (!types.every((type) => type === 'audio')) {
      // A camera (or a screen) is never used by NOVA IDE.
      return false;
    }
    return this.hasOpenSession();
  }

  /** Removes the sessions that are too old. */
  private expire(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.openedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

/** The recording sessions of the application. */
export const recordingSessions = new RecordingSessions();
