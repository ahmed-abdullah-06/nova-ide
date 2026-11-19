/**
 * One shared voice-settings controller for the whole window.
 *
 * The composer needs the stored settings for voice input; the Settings tab
 * edits them. Sharing one instance keeps the form and the composer in step
 * and avoids a second read of the same IPC channel.
 */
import { createContext, useContext, type ReactNode } from 'react';
import {
  useVoiceSettings,
  type VoiceSettingsState,
} from './useVoiceSettings';

const VoiceSettingsContext = createContext<VoiceSettingsState | null>(null);

export function VoiceSettingsProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const state = useVoiceSettings();
  return (
    <VoiceSettingsContext.Provider value={state}>
      {children}
    </VoiceSettingsContext.Provider>
  );
}

export function useVoiceSettingsContext(): VoiceSettingsState {
  const context = useContext(VoiceSettingsContext);
  if (context === null) {
    throw new Error(
      'useVoiceSettingsContext must be used inside <VoiceSettingsProvider>',
    );
  }
  return context;
}
