/**
 * Bottom panel of the application (spec §6.1).
 *
 * Hosts the terminal, problems list and task output. All three stay mounted
 * and are hidden with CSS: hiding a tab must not kill a live shell session or
 * discard its output. The header actions execute registry commands supplied
 * by the shell, so the buttons cannot drift from the menu/keyboard model.
 */
import type { ReactNode } from 'react';
import type { BottomPanelTab } from '../../commands/types';
import { Icon } from '../ui/icons';

interface TabDefinition {
  id: BottomPanelTab;
  label: string;
}

const TABS: readonly TabDefinition[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
];

export interface BottomPanelProps {
  /** Renders the terminal panel. */
  renderTerminal: () => ReactNode;
  /** Renders the problems panel. */
  renderProblems: () => ReactNode;
  /** Renders the task output panel. */
  renderOutput: () => ReactNode;
  /** Number of problems, shown as a badge on the problems tab. */
  problemCount?: number;
  /** Active tab (controlled by the shell). */
  active: BottomPanelTab;
  /** Selects a tab while the panel is visible. */
  onSelectTab: (tab: BottomPanelTab) => void;
  /** CSS-only visibility so the terminal session survives a toggle. */
  visible: boolean;
  /** True while the panel fills the editor column. */
  maximized: boolean;
  /** Executes `a6.terminal.new`. */
  onNewTerminal: () => void;
  /** Executes `a6.view.maximizeBottomPanel`. */
  onToggleMaximize: () => void;
  /** Executes `a6.view.closeBottomPanel`. */
  onClose: () => void;
}

export function BottomPanel({
  renderTerminal,
  renderProblems,
  renderOutput,
  problemCount = 0,
  active,
  onSelectTab,
  visible,
  maximized,
  onNewTerminal,
  onToggleMaximize,
  onClose,
}: BottomPanelProps): ReactNode {
  return (
    <section
      className={`bottom-panel${visible ? '' : ' bottom-panel--hidden'}`}
      aria-label="Bottom panel"
      aria-hidden={!visible}
    >
      <div className="bottom-panel__header">
        <div className="bottom-panel__tabs" role="tablist" aria-label="Panel views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className={`bottom-panel__tab${
                active === tab.id ? ' bottom-panel__tab--active' : ''
              }`}
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'problems' && problemCount > 0 ? (
                <span className="bottom-panel__badge">{problemCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="bottom-panel__actions">
          <button
            type="button"
            className="bottom-panel__action"
            onClick={onNewTerminal}
            title="New Terminal"
            aria-label="New Terminal"
          >
            <Icon name="newTerminal" size={14} />
          </button>
          <button
            type="button"
            className="bottom-panel__action"
            onClick={onToggleMaximize}
            title={maximized ? 'Restore Panel' : 'Maximize Panel'}
            aria-label={maximized ? 'Restore Panel' : 'Maximize Panel'}
            aria-pressed={maximized}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
          </button>
          <button
            type="button"
            className="bottom-panel__action"
            onClick={onClose}
            title="Close Panel"
            aria-label="Close Panel"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
      <div className="bottom-panel__body" role="tabpanel">
        <div className={`bottom-panel__content${active === 'terminal' ? '' : ' bottom-panel__content--hidden'}`}>
          {renderTerminal()}
        </div>
        <div className={`bottom-panel__content${active === 'problems' ? '' : ' bottom-panel__content--hidden'}`}>
          {renderProblems()}
        </div>
        <div className={`bottom-panel__content${active === 'output' ? '' : ' bottom-panel__content--hidden'}`}>
          {renderOutput()}
        </div>
      </div>
    </section>
  );
}
