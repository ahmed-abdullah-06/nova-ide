import type { ReactNode } from 'react';

/**
 * AI Assistant panel shell (spec §6.1).
 * The composer is intentionally disabled until real AI providers exist —
 * no simulated responses are shown (spec §26.7).
 */
export function AiPanel(): ReactNode {
  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <div className="ai-panel__header">
        <span>AI Assistant</span>
        <span aria-hidden="true">·</span>
      </div>
      <div className="ai-panel__body">
        <div className="placeholder-view">
          <span className="placeholder-view__title">No conversation yet</span>
          <span className="placeholder-view__note">
            Ask questions about code, request explanations, or start an agent
            task once AI providers are connected.
          </span>
          <span className="placeholder-view__milestone">Milestone 4</span>
        </div>
      </div>
      <div className="ai-panel__composer">
        <textarea
          className="ai-panel__input"
          placeholder="Chat is unavailable until AI providers arrive (Milestone 4)"
          disabled
          aria-label="Chat input (unavailable)"
        />
        <div className="ai-panel__hint">
          Local (Ollama) and cloud providers are planned; nothing is sent
          anywhere yet.
        </div>
      </div>
    </aside>
  );
}
