/** Honest Welcome editor tab backed by real commands and recent workspaces. */
import { useEffect, type ReactNode } from 'react';
import a6Mark from '../../../../icons/a6-64.png';
import type { RecentWorkspace } from '../../../shared/ipc-types';
import { COMMAND_IDS } from '../../commands/catalog';
import { useCommands } from '../../commands/CommandProvider';
import { Icon, type IconName } from '../../components/ui/icons';
import { useWorkspaceActions } from '../workspace/hooks/useWorkspaceActions';

export interface WelcomeViewProps {
  recent: readonly RecentWorkspace[];
}

interface StartAction {
  id: string;
  label: string;
  icon: IconName;
}

const START_ACTIONS: readonly StartAction[] = [
  { id: COMMAND_IDS.newFile, label: 'New File', icon: 'file' },
  { id: COMMAND_IDS.openFile, label: 'Open File...', icon: 'file' },
  { id: COMMAND_IDS.openWorkspace, label: 'Open Folder / Workspace...', icon: 'folderOpen' },
  { id: COMMAND_IDS.quickOpen, label: 'Quick Open...', icon: 'search' },
];

const HELP_ACTIONS: readonly StartAction[] = [
  { id: COMMAND_IDS.shortcuts, label: 'Keyboard Shortcuts', icon: 'keyboard' },
  { id: COMMAND_IDS.about, label: 'About A6', icon: 'info' },
  { id: COMMAND_IDS.openLogsFolder, label: 'Open Logs / Data Folder', icon: 'folderOpen' },
];

function ActionButton({ action }: { action: StartAction }): ReactNode {
  const { executeFromMenu, isCommandEnabled } = useCommands();
  const enabled = isCommandEnabled(action.id);
  return (
    <button
      type="button"
      className="welcome-view__action"
      disabled={!enabled}
      onClick={() => executeFromMenu(action.id)}
      title={enabled ? action.label : 'Not available in this state'}
    >
      <Icon name={action.icon} size={15} />
      <span>{action.label}</span>
    </button>
  );
}

/** Start / Recent / Help, using only actions that already exist in A6. */
export function WelcomeView({ recent }: WelcomeViewProps): ReactNode {
  const { executeFromMenu } = useCommands();
  const { loadRecent } = useWorkspaceActions();

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  return (
    <div className="welcome-view" role="region" aria-label="Welcome">
      <div className="welcome-view__hero">
        <span className="welcome-view__mark" aria-hidden="true">
          <img src={a6Mark} alt="" />
        </span>
        <div>
          <h1>Welcome to A6</h1>
          <p>Open a folder or file to begin. Everything stays local unless you choose otherwise.</p>
        </div>
      </div>
      <div className="welcome-view__grid">
        <section className="welcome-view__section" aria-labelledby="welcome-start">
          <h2 id="welcome-start">Start</h2>
          {START_ACTIONS.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </section>
        <section className="welcome-view__section" aria-labelledby="welcome-recent">
          <h2 id="welcome-recent">Recent Workspaces</h2>
          {recent.length === 0 ? (
            <p className="welcome-view__empty">No recent workspaces yet.</p>
          ) : (
            <div className="welcome-view__recent">
              {recent.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="welcome-view__action"
                  title={item.rootPath}
                  onClick={() =>
                    executeFromMenu(COMMAND_IDS.openRecentWorkspace, item.rootPath)
                  }
                >
                  <Icon name="folderOpen" size={15} />
                  <span className="welcome-view__recent-name">{item.name}</span>
                  <span className="welcome-view__recent-path">{item.rootPath}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="welcome-view__section" aria-labelledby="welcome-help">
          <h2 id="welcome-help">Help</h2>
          {HELP_ACTIONS.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </section>
      </div>
    </div>
  );
}
