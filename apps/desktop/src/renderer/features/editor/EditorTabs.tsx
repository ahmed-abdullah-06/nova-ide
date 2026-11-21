import { useState, type MouseEvent, type ReactNode } from 'react';
import { ContextMenu, type ContextMenuItem } from '../../components/ui/ContextMenu';
import { Icon } from '../../components/ui/icons';
import { FileIcon } from '../explorer/fileIcons';
import type { EditorTab } from '../../stores/tabsReducer';
import { COMMAND_IDS } from '../../commands/catalog';

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Executes a registry command with the right-clicked tab as its argument. */
  onContextAction: (id: string, tabId: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  tabId: string;
}

const TAB_MENU: readonly ContextMenuItem[] = [
  { id: COMMAND_IDS.closeTabById, label: 'Close' },
  { id: COMMAND_IDS.closeOtherTabs, label: 'Close Others', shortcut: 'Ctrl+K Ctrl+X' },
  { id: COMMAND_IDS.closeAllTabs, label: 'Close All', shortcut: 'Ctrl+K Ctrl+W' },
  {
    id: COMMAND_IDS.copyTabPath,
    label: 'Copy Path',
    shortcut: 'Ctrl+K Ctrl+C',
    separatorBefore: true,
  },
];

export function EditorTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNew,
  onContextAction,
}: EditorTabsProps): ReactNode {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const closeTab = (tab: EditorTab): void => {
    // OnClose executes the registry command, which owns dirty confirmation.
    onClose(tab.id);
  };

  const openMenu = (event: MouseEvent, tabId: string): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, tabId });
  };

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open editors">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const settings = tab.kind === 'settings';
        const welcome = tab.kind === 'welcome';
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`editor-tab${active ? ' editor-tab--active' : ''}${
              settings ? ' editor-tab--settings' : ''
            }${welcome ? ' editor-tab--welcome' : ''}`}
            onClick={() => onActivate(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(tab.id);
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                closeTab(tab);
              }
            }}
            onContextMenu={(event) => openMenu(event, tab.id)}
            title={tab.filePath ?? tab.name}
          >
            {settings ? (
              <Icon name="settings" size={14} className="editor-tab__icon" />
            ) : welcome ? (
              <Icon name="app" size={14} className="editor-tab__icon" />
            ) : (
              <FileIcon name={tab.name} kind="file" expanded={false} />
            )}
            <span className="editor-tab__name">{tab.name}</span>
            <span className="editor-tab__close-wrap">
              {tab.isDirty ? (
                <span className="editor-tab__dirty" title="Unsaved changes" />
              ) : null}
              <button
                type="button"
                className="editor-tab__close"
                aria-label={`Close ${tab.name}`}
                title="Close"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab);
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 2.5l7 7m0-7l-7 7" />
                </svg>
              </button>
            </span>
          </div>
        );
      })}

      <button
        type="button"
        className="editor-tabs__new"
        onClick={onNew}
        title="New untitled buffer"
        aria-label="New untitled buffer"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M7 2.5v9M2.5 7h9" />
        </svg>
      </button>

      {menu === null ? null : (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={TAB_MENU}
          onSelect={(id) => onContextAction(id, menu.tabId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
