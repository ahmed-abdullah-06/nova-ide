/**
 * Bottom panel of the application (spec §6.1).
 *
 * Hosts the panels that work on the project: the integrated terminal, the
 * problems list and the task output. Each panel is only mounted while it is
 * visible, so a hidden panel costs no resources.
 */
import { useState, type ReactNode } from 'react';

type BottomPanelTab = 'terminal';

interface TabDefinition {
  id: BottomPanelTab;
  label: string;
}

const TABS: readonly TabDefinition[] = [{ id: 'terminal', label: 'Terminal' }];

export interface BottomPanelProps {
  /** Renders the terminal panel. */
  renderTerminal: () => ReactNode;
}

export function BottomPanel({ renderTerminal }: BottomPanelProps): ReactNode {
  const [active, setActive] = useState<BottomPanelTab>('terminal');

  return (
    <section className="bottom-panel" aria-label="Bottom panel">
      <div className="bottom-panel__header" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`bottom-panel__tab${
              active === tab.id ? ' bottom-panel__tab--active' : ''
            }`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="bottom-panel__body" role="tabpanel">
        {active === 'terminal' ? renderTerminal() : null}
      </div>
    </section>
  );
}
