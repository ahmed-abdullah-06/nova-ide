import type { ReactNode } from 'react';
import { PlaceholderView } from './PlaceholderView';

/**
 * Bottom panel with the terminal tab (spec §6.1).
 * Terminal execution arrives in Milestone 3 (node-pty).
 */
export function TerminalPanel(): ReactNode {
  return (
    <section className="bottom-panel" aria-label="Bottom panel">
      <div className="bottom-panel__header" role="tablist">
        <span className="bottom-panel__tab">Problems</span>
        <span className="bottom-panel__tab">Output</span>
        <span className="bottom-panel__tab bottom-panel__tab--active" role="tab" aria-selected="true">
          Terminal
        </span>
      </div>
      <div className="bottom-panel__body" role="tabpanel">
        <PlaceholderView
          title="Integrated Terminal"
          note="Run commands in multiple terminal sessions without leaving NOVA IDE."
          milestone="Milestone 3"
        />
      </div>
    </section>
  );
}
