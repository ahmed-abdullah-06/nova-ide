/**
 * Menu model derived entirely from command definitions.
 *
 * The menu stores command ids and structural separators only — never click
 * handlers or shortcut strings. Labels and key combinations come from the
 * registry, so the menu, keyboard shortcuts and future palette cannot drift.
 */
import { COMMAND_IDS } from './catalog';
import { describeKeybinding } from './keybindings';
import type {
  CommandCategory,
  CommandContext,
  CommandDefinition,
  Platform,
} from './types';

export const MENU_CATEGORIES: readonly CommandCategory[] = [
  'File',
  'Edit',
  'View',
  'Window',
  'Help',
];

const SEPARATOR = '__separator__';

/** Exact A6 menu content, in display order. */
const MENU_LAYOUT: Record<CommandCategory, readonly string[]> = {
  File: [
    COMMAND_IDS.newFile,
    COMMAND_IDS.openFile,
    COMMAND_IDS.openWorkspace,
    SEPARATOR,
    COMMAND_IDS.save,
    COMMAND_IDS.saveAs,
    COMMAND_IDS.saveAll,
    SEPARATOR,
    COMMAND_IDS.closeTab,
    COMMAND_IDS.exit,
  ],
  Edit: [
    COMMAND_IDS.undo,
    COMMAND_IDS.redo,
    SEPARATOR,
    COMMAND_IDS.cut,
    COMMAND_IDS.copy,
    COMMAND_IDS.paste,
    SEPARATOR,
    COMMAND_IDS.findInFile,
    COMMAND_IDS.replaceInFile,
    COMMAND_IDS.findInWorkspace,
  ],
  View: [
    COMMAND_IDS.commandPalette,
    SEPARATOR,
    COMMAND_IDS.toggleExplorer,
    COMMAND_IDS.toggleSearch,
    COMMAND_IDS.toggleSourceControl,
    COMMAND_IDS.toggleAiPanel,
    COMMAND_IDS.toggleTerminal,
    SEPARATOR,
    COMMAND_IDS.zoomIn,
    COMMAND_IDS.zoomOut,
    COMMAND_IDS.resetZoom,
  ],
  Window: [
    COMMAND_IDS.newWindow,
    COMMAND_IDS.minimize,
    COMMAND_IDS.toggleMaximize,
    COMMAND_IDS.toggleFullScreen,
    COMMAND_IDS.closeWindow,
  ],
  Help: [
    COMMAND_IDS.shortcuts,
    COMMAND_IDS.toggleDevTools,
    COMMAND_IDS.openLogsFolder,
    SEPARATOR,
    COMMAND_IDS.about,
  ],
};

export interface MenuItem {
  kind: 'item';
  id: string;
  label: string;
  /** Derived from the command's keybinding; null when there is none. */
  shortcut: string | null;
  enabled: boolean;
  /** True/false for toggles; null for regular actions. */
  checked: boolean | null;
  /** Why the item is disabled (shown as a native title tooltip). */
  disabledReason: string | null;
  /** Honest note for planned items. */
  plannedHint: string | null;
}

export interface MenuSeparator {
  kind: 'separator';
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface MenuSection {
  category: CommandCategory;
  label: string;
  entries: readonly MenuEntry[];
}

/**
 * Builds the menu for a context. Missing or mis-grouped commands throw —
 * the menu never silently renders a fake or stale item.
 */
export function buildMenuModel(
  definitions: readonly CommandDefinition[],
  context: CommandContext,
  platform: Platform,
): MenuSection[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return MENU_CATEGORIES.map((category) => {
    const entries: MenuEntry[] = [];
    for (const id of MENU_LAYOUT[category]) {
      if (id === SEPARATOR) {
        entries.push({ kind: 'separator' });
        continue;
      }
      const definition = byId.get(id);
      if (definition === undefined) {
        throw new Error(`Menu references unknown command "${id}"`);
      }
      if (definition.category !== category) {
        throw new Error(`Command "${id}" is in the wrong menu category`);
      }
      const enabled = definition.enabled?.(context) ?? true;
      const spec = definition.keybindings?.[platform];
      entries.push({
        kind: 'item',
        id,
        label: definition.title,
        shortcut: spec == null ? null : describeKeybinding(spec, platform),
        enabled,
        checked: definition.checked?.(context) ?? null,
        disabledReason: enabled
          ? null
          : (definition.disabledHint?.(context) ??
            definition.plannedHint ??
            'Not available in this build'),
        plannedHint: definition.plannedHint ?? null,
      });
    }
    return { category, label: category, entries };
  });
}
