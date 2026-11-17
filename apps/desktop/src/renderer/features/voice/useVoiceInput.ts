/**
 * The voice input of the composer (spec §15.1, §15.4, Milestone 8).
 *
 * The hook joins the capture with the recognition:
 *
 *  1. the user presses the microphone button (or the push-to-talk key),
 *  2. the hook asks the main process for a session and opens the
 *     microphone,
 *  3. on stop the samples go to the main process, which runs the engine
 *     that *it* chose,
 *  4. the text is handed to `onTranscript`, which only inserts it into the
 *     composer — it is never sent.
 *
 * A recognition can be cancelled, and the microphone is released on every
 * path. The hook never starts by itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceCapture } from './useVoiceCapture';

/** What the hook reports to the panel. */
export interface VoiceInputState {
  /** True while the microphone is open. */
  recording: boolean;
  /** True while the microphone is being opened or closed. */
  busy: boolean;
  /** True while the engine is recognising the recording. */
  processing: boolean;
  /** The seconds the current recording is running. */
  elapsedSeconds: number;
  /** A message for the user (null when there is nothing to say). */
  notice: string | null;
}

/** The handle the panel uses. */
export interface VoiceInput extends VoiceInputState {
  /** Starts or stops the recording. */
  toggle: () => Promise<void>;
  /** Cancels the recording or the recognition. */
  cancel: () => void;
  /** Removes the message. */
  clearNotice: () => void;
}

/** The options of the hook. */
export interface UseVoiceInputOptions {
  /**
   * Receives the recognised text. The composer appends it to the input;
   * nothing is sent.
   */
  onTranscript: (text: string) => void;
}

/**
 * Records and recognises the speech of the user.
 */
export function useVoiceInput(options: UseVoiceInputOptions): VoiceInput {
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const callback = useRef(options.onTranscript);
  callback.current = options.onTranscript;

  const capture = useVoiceCapture({
    onResult: async (result, sessionId) => {
      if (sessionId === null) {
        setNotice('The recording session has ended.');
        return;
      }
      const voice = window.nova?.voice;
      if (voice === undefined) {
        setNotice('The voice assistant is not available in this window.');
        return;
      }
      setProcessing(true);
      setNotice(null);
      try {
        const outcome = await voice.transcribe(
          sessionId,
          result.samples.buffer as ArrayBuffer,
        );
        if (!outcome.ok) {
          setNotice(outcome.message);
          return;
        }
        const text = outcome.value.text.trim();
        if (text.length === 0) {
          setNotice(
            'No speech was recognised. Move closer to the microphone and try again.',
          );
          return;
        }
        callback.current(text);
        if (outcome.value.truncated) {
          setNotice('The recording was stopped at the limit of its length.');
        }
      } catch {
        setNotice('The speech recognition failed.');
      } finally {
        setProcessing(false);
      }
    },
  });

  const toggle = useCallback(async (): Promise<void> => {
    if (capture.recording) {
      await capture.stop();
      return;
    }
    if (capture.busy || processing) {
      return;
    }
    const voice = window.nova?.voice;
    if (voice === undefined) {
      setNotice('The voice assistant is not available in this window.');
      return;
    }
    setNotice(null);
    try {
      const settings = await voice.settings();
      if (!settings.enabled) {
        setNotice(
          'The voice assistant is switched off. Switch it on in the voice settings.',
        );
        return;
      }
      if (settings.engine === 'none') {
        setNotice(
          'No speech engine is configured. Choose the local engine in the voice settings.',
        );
        return;
      }
      await capture.start();
    } catch {
      setNotice('The voice settings could not be read.');
    }
  }, [capture, processing]);

  const cancel = useCallback((): void => {
    capture.cancel();
    void window.nova?.voice.cancelTranscription().catch(() => undefined);
    setProcessing(false);
    setNotice(null);
  }, [capture]);

  const clearNotice = useCallback((): void => {
    setNotice(null);
    capture.clearError();
  }, [capture]);

  // A capture error is shown exactly like a recognition error.
  useEffect(() => {
    if (capture.error !== null) {
      setNotice(capture.error);
    }
  }, [capture.error]);

  // A recognition never outlives the panel that started it.
  useEffect(() => {
    return () => {
      void window.nova?.voice.cancelTranscription().catch(() => undefined);
    };
  }, []);

  return {
    recording: capture.recording,
    busy: capture.busy,
    processing,
    elapsedSeconds: capture.elapsedSeconds,
    notice,
    toggle,
    cancel,
    clearNotice,
  };
}
