/**
 * The hook of the microphone (spec §15.1, Milestone 8).
 *
 * The hook owns the lifecycle of one recording:
 *
 *  - it asks the main process for a session *before* the microphone is
 *    opened, so the browser permission handler knows that the user asked
 *    for it,
 *  - it releases the microphone and closes the session on every path —
 *    stop, cancel, error, unmount, or the limit of the length,
 *  - it never starts by itself: only a user action calls `start`.
 *
 * The samples are only handed to the callback (the main process). They
 * are never written to the disk and never kept longer than the recording.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptureError,
  MAX_RECORDING_SECONDS,
  MicrophoneCapture,
  type CaptureResult,
} from './audio';

/** What the hook reports to the panel. */
export interface VoiceCaptureState {
  /** True while the microphone is open. */
  recording: boolean;
  /** True while the microphone is being opened or closed. */
  busy: boolean;
  /** The seconds the current recording is running. */
  elapsedSeconds: number;
  /** The message of a failure (null when everything worked). */
  error: string | null;
}

/** The options of the hook. */
export interface UseVoiceCaptureOptions {
  /** Called with the samples when a recording ends. The session is still
   *  open while the promise runs, so the main process can tie the audio to
   *  the recording of the user. */
  onResult?: (
    result: CaptureResult,
    sessionId: string | null,
  ) => void | Promise<void>;
  /** The maximum length (seconds). */
  maxSeconds?: number;
}

/** The handle the panel uses. */
export interface VoiceCapture extends VoiceCaptureState {
  /** Starts a recording (the user pressed the microphone). */
  start: () => Promise<void>;
  /** Stops the recording and hands the samples to `onResult`. */
  stop: () => Promise<void>;
  /** Stops the recording and throws the samples away. */
  cancel: () => void;
  /** Removes the message of the last failure. */
  clearError: () => void;
}

/**
 * Records the microphone.
 *
 * The hook must be mounted while the panel is visible. An unmount cancels
 * the recording, so the microphone can never stay open in a hidden panel.
 */
export function useVoiceCapture(
  options: UseVoiceCaptureOptions = {},
): VoiceCapture {
  const { onResult, maxSeconds = MAX_RECORDING_SECONDS } = options;
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const capture = useRef<MicrophoneCapture | null>(null);
  const sessionId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopped = useRef(false);

  /** Closes the session in the main process (idempotent). */
  const closeSession = useCallback((): void => {
    const id = sessionId.current;
    sessionId.current = null;
    if (id !== null) {
      void window.nova?.voice.closeSession(id).catch(() => undefined);
    }
  }, []);

  /** Stops the clock and the state. */
  const settle = useCallback((): void => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setRecording(false);
    setElapsedSeconds(0);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (capture.current !== null) {
      return;
    }
    setError(null);
    setBusy(true);
    stopped.current = false;
    const mic = new MicrophoneCapture();
    let opened: string | null = null;
    try {
      const session = await window.nova?.voice.openSession();
      if (session === undefined) {
        throw new CaptureError(
          'The voice assistant is not available in this window.',
          'unsupported',
        );
      }
      opened = session.sessionId;
      sessionId.current = opened;
      await mic.start(maxSeconds);
      capture.current = mic;
      setRecording(true);
      setElapsedSeconds(0);
      timer.current = setInterval(() => {
        setElapsedSeconds((current) => {
          const next = current + 0.25;
          if (next >= maxSeconds) {
            // The capture stops itself at the limit; the hook closes the
            // session and releases the permission.
            queueMicrotask(() => {
              void finish(mic, true);
            });
            return maxSeconds;
          }
          return next;
        });
      }, 250);
    } catch (caught) {
      mic.cancel();
      if (opened !== null) {
        void window.nova?.voice.closeSession(opened).catch(() => undefined);
      }
      sessionId.current = null;
      setError(
        caught instanceof CaptureError
          ? caught.message
          : 'The microphone could not be opened.',
      );
      settle();
    } finally {
      setBusy(false);
    }

    /**
     * Ends the recording and hands the samples to the callback.
     *
     * A function (not a hook value), so the interval and the unmount can
     * use the same path.
     */
    async function finish(
      active: MicrophoneCapture,
      fromLimit: boolean,
    ): Promise<void> {
      if (stopped.current) {
        return;
      }
      stopped.current = true;
      if (timer.current !== null) {
        clearInterval(timer.current);
        timer.current = null;
      }
      capture.current = null;
      setRecording(false);
      setBusy(true);
      try {
        const result = await active.stop();
        if (fromLimit && !result.truncated) {
          // The engine may have stopped a moment before the limit: the
          // sample is complete, the flag only describes the reason.
          result.truncated = true;
        }
        if (result.seconds > 0) {
          await onResult?.(result, sessionId.current);
        }
        closeSession();
      } catch {
        closeSession();
        setError('The recording could not be stopped.');
      } finally {
        setElapsedSeconds(0);
        setBusy(false);
        active.cancel();
      }
    }
  }, [closeSession, maxSeconds, onResult, settle]);

  const stop = useCallback(async (): Promise<void> => {
    const active = capture.current;
    if (active === null) {
      return;
    }
    stopped.current = false;
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    capture.current = null;
    setRecording(false);
    setBusy(true);
    try {
      const result = await active.stop();
      if (result.seconds > 0) {
        await onResult?.(result, sessionId.current);
      }
      closeSession();
    } catch {
      closeSession();
      setError('The recording could not be stopped.');
    } finally {
      setElapsedSeconds(0);
      setBusy(false);
      active.cancel();
    }
  }, [closeSession, onResult]);

  const cancel = useCallback((): void => {
    stopped.current = true;
    const active = capture.current;
    capture.current = null;
    active?.cancel();
    closeSession();
    settle();
    setBusy(false);
  }, [closeSession, settle]);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  // The microphone is released when the panel disappears — even when the
  // application is closed while a recording is running.
  useEffect(() => {
    return () => {
      stopped.current = true;
      capture.current?.cancel();
      capture.current = null;
      const id = sessionId.current;
      sessionId.current = null;
      if (id !== null) {
        void window.nova?.voice.closeSession(id).catch(() => undefined);
      }
      if (timer.current !== null) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, []);

  return {
    recording,
    busy,
    elapsedSeconds,
    error,
    start,
    stop,
    cancel,
    clearError,
  };
}
