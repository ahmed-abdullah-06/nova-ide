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
 * path. The hook never starts by itself: the button, the push-to-talk key
 * and the confirmation of a cloud service are all actions of the user.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matchesPushToTalkKey,
  matchesPushToTalkRelease,
  parsePushToTalkKey,
} from '../../../shared/pushToTalk';
import type { VoiceSettings } from '../../../shared/voice-types';
import { useConfirm } from '../../components/ui/ConfirmProvider';
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
  /** The stored settings (null until they are read). */
  settings: VoiceSettings | null;
}

/** True when the target of a key event is a field the user types in. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

/**
 * Records and recognises the speech of the user.
 */
export function useVoiceInput(options: UseVoiceInputOptions): VoiceInput {
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm } = useConfirm();
  const callback = useRef(options.onTranscript);
  callback.current = options.onTranscript;
  // True only for the recording that the user approved for a cloud service.
  const cloudApproved = useRef(false);
  const settingsRef = useRef(options.settings);
  settingsRef.current = options.settings;

  const capture = useVoiceCapture({
    maxSeconds: options.settings?.maxRecordingSeconds,
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
      const approved = cloudApproved.current;
      cloudApproved.current = false;
      setProcessing(true);
      setNotice(null);
      try {
        const outcome = await voice.transcribe(
          sessionId,
          result.samples.buffer as ArrayBuffer,
          approved,
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
      if (settings.engine === 'cloud') {
        // The approval belongs to this recording only. The main process asks
        // again and remains the authority for any external transfer.
        const approved = await confirm(
          'A cloud speech service would send this recording to an external service.\n\n' +
            'The audio would leave this machine. Send this recording?',
          {
            title: 'Cloud speech service',
            confirmLabel: 'Send recording',
            cancelLabel: 'Do not send',
            destructive: true,
          },
        );
        if (!approved) {
          setNotice(
            'The recording was not started: you did not approve the cloud speech service.',
          );
          return;
        }
        cloudApproved.current = true;
      }
      await capture.start();
    } catch {
      cloudApproved.current = false;
      setNotice('The voice settings could not be read.');
    }
  }, [capture, confirm, processing]);

  const cancel = useCallback((): void => {
    cloudApproved.current = false;
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
      cloudApproved.current = false;
      void window.nova?.voice.cancelTranscription().catch(() => undefined);
    };
  }, []);

  // The push-to-talk key. The binding is parsed from the settings, so an
  // invalid text simply never matches. A modifier-less printable key in a
  // text field is ignored: typing must never record.
  const binding = useMemo(
    () => parsePushToTalkKey(options.settings?.pushToTalkKey ?? ''),
    [options.settings?.pushToTalkKey],
  );
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const processingRef = useRef(processing);
  processingRef.current = processing;
  const enabled = options.settings?.enabled === true;

  useEffect(() => {
    if (!enabled || binding === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesPushToTalkKey(event, binding)) {
        return;
      }
      if (
        binding.ctrl === false &&
        binding.alt === false &&
        binding.meta === false &&
        !/^F\d{1,2}$/.test(binding.key) &&
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      const state = captureRef.current;
      if (state.recording || state.busy || processingRef.current) {
        return;
      }
      void toggleRef.current();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!matchesPushToTalkRelease(event, binding)) {
        return;
      }
      if (captureRef.current.recording) {
        void captureRef.current.stop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [binding, enabled]);

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
