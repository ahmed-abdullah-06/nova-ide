import type { ReactNode } from 'react';
import type { EditorTab } from '../../stores/tabsReducer';

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function EditorTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNew,
}: EditorTabsProps): ReactNode {
  /**
   * Closes a tab.
   *
   * A tab with unsaved changes is only closed after a confirmation, so
   * the work is never lost silently.
   */
  const closeTab = (tab: EditorTab): void => {
    if (
      !tab.isDirty ||
      window.confirm(`Close "${tab.name}"? Unsaved changes will be lost.`)
    ) {
      onClose(tab.id);
    }
  };

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open editors">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`editor-tab${active ? ' editor-tab--active' : ''}`}
            onClick={() => onActivate(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(tab.id);
              }
            }}
            onAuxClick={(event) => {
              // The middle mouse button closes a tab.
              if (event.button === 1) {
                event.preventDefault();
                closeTab(tab);
              }
            }}
            title={tab.filePath ?? tab.name}
          >
            <span className="editor-tab__name">{tab.name}</span>
            {tab.isDirty && (
              <span
                className="editor-tab__dirty"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
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
    </div>
  );
}
