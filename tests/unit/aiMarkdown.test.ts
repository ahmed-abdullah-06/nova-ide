/**
 * Tests for the Markdown parser of the chat (spec §6.1, §19.4).
 *
 * The answer of a model is untrusted input, so the parser must never
 * produce markup that could reach the document, and it must only accept
 * links that point at http or https.
 */
import { describe, expect, it } from 'vitest';
import {
  isSafeLink,
  parseInline,
  parseMarkdown,
} from '../../apps/desktop/src/renderer/features/ai/markdown';

describe('markdown parser', () => {
  it('parses headings', () => {
    const blocks = parseMarkdown('# Title\n\n## Subtitle');
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Title' });
    expect(blocks[1]).toEqual({ type: 'heading', level: 2, text: 'Subtitle' });
  });

  it('parses paragraphs', () => {
    const blocks = parseMarkdown('First line\nsecond line\n\nAnother paragraph');
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'First line\nsecond line' });
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'Another paragraph' });
  });

  it('parses a fenced code block with its language', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(blocks[0]).toEqual({
      type: 'code',
      language: 'ts',
      code: 'const a = 1;',
    });
  });

  it('parses a code block without a language', () => {
    const blocks = parseMarkdown('```\nplain\n```');
    expect(blocks[0]).toEqual({ type: 'code', language: '', code: 'plain' });
  });

  it('keeps the markdown of a code block untouched', () => {
    const blocks = parseMarkdown('```md\n# not a heading\n```');
    expect(blocks[0]).toEqual({
      type: 'code',
      language: 'md',
      code: '# not a heading',
    });
  });

  it('parses bullet and numbered lists', () => {
    const blocks = parseMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(blocks[0]).toEqual({ type: 'list', ordered: false, items: ['one', 'two'] });
    expect(blocks[1]).toEqual({
      type: 'list',
      ordered: true,
      items: ['first', 'second'],
    });
  });

  it('parses block quotes and rules', () => {
    const blocks = parseMarkdown('> a quote\n\n---');
    expect(blocks[0]).toEqual({ type: 'quote', text: 'a quote' });
    expect(blocks[1]).toEqual({ type: 'rule' });
  });

  it('parses a table', () => {
    const blocks = parseMarkdown(
      '| name | value |\n| --- | --- |\n| a | 1 |\n| b | 2 |',
    );
    expect(blocks[0]).toEqual({
      type: 'table',
      header: ['name', 'value'],
      rows: [
        ['a', '1'],
        ['b', '2'],
      ],
    });
  });

  it('returns nothing for an empty text', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });

  it('never produces markup of the model', () => {
    // The parser only returns text; the markup is rendered as text.
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>');
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      text: '<img src=x onerror=alert(1)>',
    });
  });
});

describe('inline markdown', () => {
  it('parses bold, italic and strikethrough', () => {
    expect(parseInline('**bold**')).toEqual([
      { type: 'bold', text: 'bold' },
    ]);
    expect(parseInline('*italic*')).toEqual([
      { type: 'italic', text: 'italic' },
    ]);
    expect(parseInline('~~gone~~')).toEqual([
      { type: 'strike', text: 'gone' },
    ]);
  });

  it('parses inline code', () => {
    expect(parseInline('use `npm test` now')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'npm test' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('keeps a safe link', () => {
    expect(parseInline('[docs](https://example.com)')).toEqual([
      { type: 'link', text: 'docs', url: 'https://example.com' },
    ]);
  });

  it('turns an unsafe link into plain text', () => {
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[bad](javascript:alert(1))' },
    ]);
    expect(parseInline('[bad](file:///etc/passwd)')).toEqual([
      { type: 'text', text: '[bad](file:///etc/passwd)' },
    ]);
  });

  it('knows which addresses may be opened', () => {
    expect(isSafeLink('https://example.com')).toBe(true);
    expect(isSafeLink('http://example.com')).toBe(true);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('file:///etc/passwd')).toBe(false);
    expect(isSafeLink('not a url')).toBe(false);
  });
});
