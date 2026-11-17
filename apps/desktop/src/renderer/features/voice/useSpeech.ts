/**
 * The read-aloud of an answer (spec §15.2, Milestone 8).
 *
 * The speech is produced by the offline voices of the operating system
 * (`speechSynthesis`) — no network, no dependency, no permission. The
 * text is prepared (secrets redacted, code skipped by default) and the
 * user can stop the speech at any time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechSpeaker, prepareSpeech } from './speech';

/** What the panel uses. */
export interface UseSpeech {
  /** True when the operating system offers a speech engine. */
  supported: boolean;
  /** True while a text is spoken. */
  speaking: boolean;
  /** The message that is being spoken (null otherwise). */
  speakingIndex: number | null;
  /** A message for the user (null when there is nothing to say). */
  notice: string | null;
  /** Reads the message of that index aloud (or stops it). */
  read: (text: string, index: number) => void;
  /** Stops the speech at once. */
  stop: () => void;
  /** Removes the message. */
  clearNotice: () => void;
}

export function useSpeech(): UseSpeech {
  const speaker = useRef<SpeechSpeaker | null>(null);
  const [supported, setSupported] = useState(
    typeof globalThis.speechSynthesis !== 'undefined',
  );
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const engine = useCallback((): SpeechSpeaker => {
    if (speaker.current === null) {
      speaker.current = new SpeechSpeaker();
      setSupported(speaker.current.supported);
    }
    return speaker.current;
  }, []);

  const stop = useCallback((): void => {
    speaker.current?.stop();
    setSpeakingIndex(null);
  }, []);

  const read = useCallback(
    (text: string, index: number): void => {
      if (speakingIndex === index) {
        stop();
        return;
      }
      const voice = engine();
      if (!voice.supported) {
        setSupported(false);
        setNotice('This system has no speech engine for reading aloud.');
        return;
      }
      const start = async (): Promise<void> => {
        let settings = null;
        try {
          settings = (await window.nova?.voice.settings()) ?? null;
        } catch {
          settings = null;
        }
        const prepared = prepareSpeech(text, {
          readCodeBlocks: settings?.readCodeBlocks === true,
        });
        if (prepared.length === 0) {
          setNotice(
            'There is nothing to read aloud — the answer contains only code.',
          );
          return;
        }
        setNotice(null);
        const started = voice.speak(
          prepared,
          {
            voice: settings?.voice ?? '',
            rate: settings?.rate ?? 1,
          },
          () => setSpeakingIndex(null),
        );
        if (!started) {
          setSupported(false);
          setNotice('This system has no speech engine for reading aloud.');
          return;
        }
        setSpeakingIndex(index);
      };
      void start();
    },
    [engine, speakingIndex, stop],
  );

  const clearNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  // No speech outlives the panel.
  useEffect(() => {
    return () => {
      speaker.current?.stop();
    };
  }, []);

  return {
    supported,
    speaking: speakingIndex !== null,
    speakingIndex,
    notice,
    read,
    stop,
    clearNotice,
  };
}
