/**
 * The voice settings of the panel (spec §15.3, Milestone 8).
 *
 * The renderer never decides a privacy rule: it reads the settings, shows
 * them and sends a change to the main process, which sanitizes, validates
 * and stores it. A failed write is shown to the user, never hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSettings } from '../../../shared/voice-types';

/** What the settings panel uses. */
export interface VoiceSettingsState {
  /** The stored settings (null until they are read). */
  settings: VoiceSettings | null;
  /** True while the settings are being read. */
  loading: boolean;
  /** True while the settings are being written. */
  saving: boolean;
  /** The message of a failure (null when everything worked). */
  error: string | null;
  /** Reads the settings again. */
  reload: () => Promise<void>;
  /** Sends the settings to the main process; returns the stored value. */
  save: (next: VoiceSettings) => Promise<VoiceSettings | null>;
  /** Lets the user pick the engine or the model; null when cancelled. */
  pickFile: (kind: 'engine' | 'model') => Promise<string | null>;
}

export function useVoiceSettings(): VoiceSettingsState {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const voice = window.nova?.voice;
    if (voice === undefined) {
      setError('The voice assistant is not available in this window.');
      setLoading(false);
      return;
    }
    try {
      const stored = await voice.settings();
      if (mounted.current) {
        setSettings(stored);
        setError(null);
      }
    } catch {
      if (mounted.current) {
        setError('The voice settings could not be read.');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (next: VoiceSettings): Promise<VoiceSettings | null> => {
      const voice = window.nova?.voice;
      if (voice === undefined) {
        setError('The voice assistant is not available in this window.');
        return null;
      }
      setSaving(true);
      try {
        const stored = await voice.saveSettings(next);
        if (mounted.current) {
          setSettings(stored);
          setError(null);
        }
        return stored;
      } catch (caught) {
        if (mounted.current) {
          setError(
            caught instanceof Error && caught.message.length > 0
              ? `The settings could not be saved: ${caught.message}`
              : 'The settings could not be saved.',
          );
        }
        return null;
      } finally {
        if (mounted.current) {
          setSaving(false);
        }
      }
    },
    [],
  );

  const pickFile = useCallback(
    async (kind: 'engine' | 'model'): Promise<string | null> => {
      const voice = window.nova?.voice;
      if (voice === undefined) {
        setError('The voice assistant is not available in this window.');
        return null;
      }
      try {
        const result = await voice.pickFile(kind);
        if (!result.ok) {
          setError(result.message);
          return null;
        }
        return result.value;
      } catch {
        setError('The file could not be picked.');
        return null;
      }
    },
    [],
  );

  return { settings, loading, saving, error, reload, save, pickFile };
}
