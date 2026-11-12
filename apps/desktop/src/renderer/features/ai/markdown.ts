/**
 * A small, safe Markdown parser for the chat (spec §6.1).
 *
 * The answer of a model is untrusted input (spec §19.4), so the parser
 * never produces HTML: it returns a small tree of blocks that the panel
 * renders as React elements. React escapes every text, so no markup of
 * the model can reach the document.
 *
 * The supported subset covers what a model really sends:
 * headings, paragraphs, bullet and numbered lists, block quotes, fenced
 * code blocks, horizontal rules, tables and the inline forms for bold,
 * italic, strikethrough, inline code and links.
 *
 * A link is only a link when it points at http or https; every other
 * scheme (file, javascript, …) becomes plain text.
 *
 * A ready-made Markdown library would be a heavy dependency for this
 * subset (the specification asks to avoid unnecessary UI libraries), so
 * the parser is part of the application.
 */

/** One block of the answer. */
export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'table'; header: string[]; rows: string[][] };

/** One inline element of a block. */
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'strike'; text: string }
  | { type: 'link'; text: string; url: string };

/**
 * True when the address may be opened in the browser.
 *
 * Only http and https are allowed — the output of a model must never be
 * able to reach a local file or a script.
 */
export function isSafeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parses a Markdown text into blocks.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // A fenced code block.
    const fence = /^```([A-Za-z0-9+#._-]*)\s*$/.exec(line);
    if (fence !== null) {
      const language = fence[1] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (/^```\s*$/.test(current)) {
          index += 1;
          break;
        }
        code.push(current);
        index += 1;
      }
      blocks.push({ type: 'code', language, code: code.join('\n') });
      continue;
    }

    // A horizontal rule.
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    // A heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
      });
      index += 1;
      continue;
    }

    // A block quote.
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoted.join('\n') });
      continue;
    }

    // A table (a header row, a separator row and the rows).
    if (line.includes('|') && /^\s*\|?[\s:-]*\|[\s|:-]*$/.test(lines[index + 1] ?? '')) {
      const header = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // A list.
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const item = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(current)
          : /^\s*[-*+]\s+(.*)$/.exec(current);
        if (item === null) {
          break;
        }
        items.push(item[1] ?? '');
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // A paragraph (everything until an empty line).
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim().length === 0 ||
        /^```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        /^>\s?/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    }
  }

  return blocks;
}

/**
 * Parses the inline elements of a text.
 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = '';
  let index = 0;

  const flush = (): void => {
    if (text.length > 0) {
      nodes.push({ type: 'text', text });
      text = '';
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    // Inline code.
    const inlineCode = /^`([^`]+)`/.exec(rest);
    if (inlineCode !== null) {
      flush();
      nodes.push({ type: 'code', text: inlineCode[1] ?? '' });
      index += inlineCode[0].length;
      continue;
    }

    // A link.
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link !== null) {
      const url = link[2] ?? '';
      if (isSafeLink(url)) {
        flush();
        nodes.push({ type: 'link', text: link[1] ?? url, url });
        index += link[0].length;
        continue;
      }
      // An unsafe address stays plain text.
      text += link[0];
      index += link[0].length;
      continue;
    }

    // Bold, italic and strikethrough.
    const bold = /^\*\*([^*]+)\*\*/.exec(rest);
    if (bold !== null) {
      flush();
      nodes.push({ type: 'bold', text: bold[1] ?? '' });
      index += bold[0].length;
      continue;
    }
    const strike = /^~~([^~]+)~~/.exec(rest);
    if (strike !== null) {
      flush();
      nodes.push({ type: 'strike', text: strike[1] ?? '' });
      index += strike[0].length;
      continue;
    }
    const italic = /^\*([^*]+)\*/.exec(rest);
    if (italic !== null) {
      flush();
      nodes.push({ type: 'italic', text: italic[1] ?? '' });
      index += italic[0].length;
      continue;
    }

    text += source[index] ?? '';
    index += 1;
  }

  flush();
  return nodes;
}

/** Splits a table row into its cells. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}
