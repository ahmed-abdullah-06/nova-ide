/**
 * A small unified diff generator (spec §12.1).
 *
 * The agent shows its changes as a diff before the user accepts them, so
 * a diff is needed. A library would be a heavy dependency for a single
 * format, so the diff is generated here (the classic line based
 * longest-common-subsequence algorithm).
 *
 * The result is the standard unified format, so it can be shown as it
 * is and understood by every tool.
 */

/** One line of a diff. */
export interface DiffLine {
  /** The kind of the line. */
  kind: 'context' | 'added' | 'removed';
  /** The text of the line. */
  text: string;
}

/** The largest number of lines the diff is calculated for. */
const MAX_DIFF_LINES = 4000;

/**
 * Calculates the line differences of two texts.
 *
 * @param before The content before the change.
 * @param after The content after the change.
 * @returns The lines of the diff.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    // The file is too big for a line diff: the whole file is shown as a
    // replacement (the review is still possible).
    return [
      ...beforeLines.map((text) => ({ kind: 'removed' as const, text })),
      ...afterLines.map((text) => ({ kind: 'added' as const, text })),
    ];
  }

  // The longest common subsequence of the two line lists.
  const lengths: number[][] = Array.from(
    { length: beforeLines.length + 1 },
    () => new Array<number>(afterLines.length + 1).fill(0),
  );
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      const row = lengths[i] as number[];
      const nextRow = lengths[i + 1] as number[];
      row[j] =
        beforeLines[i] === afterLines[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      lines.push({ kind: 'context', text: beforeLines[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    const row = lengths[i] as number[];
    const nextRow = lengths[i + 1] as number[];
    // Skip the line that leaves the most common lines behind. On a tie
    // the line of the old text is skipped first.
    if ((nextRow[j] ?? 0) >= (row[j + 1] ?? 0)) {
      lines.push({ kind: 'removed', text: beforeLines[i] as string });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: afterLines[j] as string });
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    lines.push({ kind: 'removed', text: beforeLines[i] as string });
    i += 1;
  }
  while (j < afterLines.length) {
    lines.push({ kind: 'added', text: afterLines[j] as string });
    j += 1;
  }
  return lines;
}

/**
 * Creates the unified diff of two texts.
 *
 * @param before The content before the change.
 * @param after The content after the change.
 * @param beforeName The name of the file before the change.
 * @param afterName The name of the file after the change.
 * @returns The unified diff.
 */
export function unifiedDiff(
  before: string,
  after: string,
  beforeName: string,
  afterName: string,
): string {
  const lines = diffLines(before, after);
  const added = lines.filter((line) => line.kind === 'added').length;
  const removed = lines.filter((line) => line.kind === 'removed').length;
  if (added === 0 && removed === 0) {
    return '';
  }

  const body = lines
    .map((line) => {
      const marker =
        line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
      return `${marker}${line.text}`;
    })
    .join('\n');

  return [
    `--- a/${beforeName}`,
    `+++ b/${afterName}`,
    `@@ -1,${removed + (lines.length - added - removed)} +1,${added + (lines.length - added - removed)} @@`,
    body,
    '',
  ].join('\n');
}

/** Splits a text into its lines. */
function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline terminates the last line; it does not add an
  // empty one.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
