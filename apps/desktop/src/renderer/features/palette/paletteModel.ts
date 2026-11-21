/**
 * Pure ranking models for the command palette and Quick Open.
 *
 * The search bridge supplies candidate matches; this module only sorts what
 * the trusted bridge already returned. It never reads the filesystem.
 */
import type { SearchMatch } from '../../../shared/ipc-types';
import { describeKeybindings } from '../../commands/keybindings';
import type {
  CommandContext,
  CommandDefinition,
  Platform,
} from '../../commands/types';

export interface CommandRow {
  id: string;
  label: string;
  category: string;
  shortcut: string | null;
  score: number;
}

export interface FileRow {
  id: string;
  label: string;
  description: string;
  path: string;
  line: number;
  column: number;
  score: number;
}

/**
 * Case-insensitive subsequence score. Consecutive hits, word starts, exact
 * substrings and shorter targets rank higher. Returns null when the query is
 * not a subsequence of the text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return 0;
  }
  const haystack = text.toLowerCase();
  let cursor = 0;
  let previous = -2;
  let streak = 0;
  let score = 0;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index === -1) {
      return null;
    }
    if (index === previous + 1) {
      streak += 1;
      score += 6 + streak * 2;
    } else {
      streak = 0;
      score += 2;
    }
    if (index === 0) {
      score += 10;
    } else if (/[\s/\\_.-]/.test(haystack[index - 1] ?? '')) {
      score += 5;
    }
    previous = index;
    cursor = index + 1;
  }
  if (haystack.startsWith(needle)) {
    score += 30;
  } else if (haystack.includes(needle)) {
    score += 15;
  }
  return score - haystack.length * 0.05;
}

function byScore<T extends { score: number; label: string }>(a: T, b: T): number {
  return b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label);
}

/** Enabled, non-internal commands only; recently used commands get a small boost. */
export function rankCommands(
  query: string,
  definitions: readonly CommandDefinition[],
  context: CommandContext,
  platform: Platform,
  recentIds: readonly string[],
  limit = 50,
): CommandRow[] {
  const recentBoost = new Map(
    recentIds.map((id, index) => [id, (recentIds.length - index) * 3]),
  );
  const rows: CommandRow[] = [];
  for (const definition of definitions) {
    if (definition.paletteHidden === true || (definition.enabled?.(context) ?? true) === false) {
      continue;
    }
    const label = definition.title;
    const category = definition.category;
    const score = fuzzyScore(query, `${category} ${label}`) ?? fuzzyScore(query, label);
    if (score === null) {
      continue;
    }
    rows.push({
      id: definition.id,
      label,
      category,
      shortcut: describeKeybindings(definition.keybindings?.[platform], platform),
      score: score + (recentBoost.get(definition.id) ?? 0),
    });
  }
  return rows.sort(byScore).slice(0, limit);
}

/** Re-ranks trusted file-search results by file name and relative path. */
export function rankFiles(
  query: string,
  matches: readonly SearchMatch[],
  limit = 50,
): FileRow[] {
  const rows: FileRow[] = [];
  for (const match of matches) {
    const nameScore = fuzzyScore(query, match.name);
    const pathScore = fuzzyScore(query, match.relativePath);
    if (nameScore === null && pathScore === null) {
      continue;
    }
    rows.push({
      id: `${match.path}:${match.line}:${match.column}`,
      label: match.name,
      description: match.relativePath,
      path: match.path,
      line: match.line,
      column: match.column,
      score: Math.max(nameScore ?? -1, (pathScore ?? -1) + 1),
    });
  }
  return rows.sort(byScore).slice(0, limit);
}
