/** Palette and Quick Open overlays; both execute through the command registry. */
import { useState, type ReactNode } from 'react';
import type {
  CommandContext,
  CommandDefinition,
  Platform,
} from '../../commands/types';
import { useSearch } from '../search/useSearch';
import { rankCommands, rankFiles } from './paletteModel';
import { QuickPick, type QuickPickRow } from './QuickPick';

export interface CommandPaletteOverlayProps {
  definitions: readonly CommandDefinition[];
  context: CommandContext;
  platform: Platform;
  recentIds: readonly string[];
  onExecute: (id: string) => void;
  onClose: () => void;
}

export function CommandPaletteOverlay({
  definitions,
  context,
  platform,
  recentIds,
  onExecute,
  onClose,
}: CommandPaletteOverlayProps): ReactNode {
  const [query, setQuery] = useState('');
  const rows = rankCommands(query, definitions, context, platform, recentIds);
  return (
    <QuickPick
      title="Command Palette"
      placeholder="Type a command..."
      query={query}
      rows={rows}
      status={`${rows.length} command${rows.length === 1 ? '' : 's'}`}
      emptyMessage="No enabled command matches that text."
      onQueryChange={setQuery}
      onChoose={(row: QuickPickRow) => onExecute(row.id)}
      onClose={onClose}
    />
  );
}

export interface QuickOpenOverlayProps {
  onOpenFile: (path: string, options?: { line?: number; column?: number }) => void;
  onClose: () => void;
}

export function QuickOpenOverlay({
  onOpenFile,
  onClose,
}: QuickOpenOverlayProps): ReactNode {
  const [query, setQuery] = useState('');
  // Search view and Quick Open use distinct request prefixes so the main
  // process never sees a duplicate request id from two live consumers.
  const search = useSearch('quickopen');
  const rows = rankFiles(search.input, search.results);
  const status = search.searching
    ? 'Searching...'
    : search.input.trim() === ''
      ? 'Type part of a file name'
      : `${rows.length} file${rows.length === 1 ? '' : 's'}${
          search.truncated ? ' (more available)' : ''
        }`;
  return (
    <QuickPick
      title="Quick Open"
      placeholder="Type a file name..."
      query={query}
      rows={rows}
      status={status}
      emptyMessage={
        search.input.trim() === ''
          ? 'Start typing to search workspace files.'
          : 'No workspace files matched.'
      }
      onQueryChange={(value) => {
        setQuery(value);
        search.setInput(value);
      }}
      onChoose={(row) => {
        if (row.path === undefined) {
          return;
        }
        onOpenFile(row.path, { line: row.line ?? 0, column: row.column ?? 0 });
      }}
      onClose={onClose}
    />
  );
}
