/**
 * One shared AI controller for the whole window.
 *
 * The chat, the settings tab and the status bar all show the same provider,
 * model and privacy state. They must not create separate `useAi()` instances:
 * that would duplicate the stream subscription and let one view show a stale
 * provider after another view changed it.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useAi, type AiController } from './useAi';

const AiContext = createContext<AiController | null>(null);

export function AiProvider({ children }: { children: ReactNode }): ReactNode {
  const ai = useAi();
  return <AiContext.Provider value={ai}>{children}</AiContext.Provider>;
}

export function useAiContext(): AiController {
  const context = useContext(AiContext);
  if (context === null) {
    throw new Error('useAiContext must be used inside <AiProvider>');
  }
  return context;
}
