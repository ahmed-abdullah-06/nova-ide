/**
 * The messages of the chat (spec §6.1).
 *
 * The answer of a model is untrusted input, so it is rendered as text:
 * the Markdown parser produces a small tree of blocks and React escapes
 * every text. No markup of the model is ever executed, and a link is
 * only opened when it points at http or https.
 */
import { useCallback } from 'react';
import type { ChatMessage } from '../../../shared/ai-types';
import { CodeBlock } from './CodeBlock';
import { parseInline, parseMarkdown, type InlineNode } from './markdown';

export interface MessageListProps {
  /** The messages of the conversation. */
  messages: readonly ChatMessage[];
  /** True while an answer is still coming in. */
  streaming: boolean;
  /** Opens a link in the browser of the user. */
  onOpenLink: (url: string) => void;
}

/** Renders the inline elements of a text. */
function renderInline(
  nodes: InlineNode[],
  keyPrefix: string,
  onOpenLink: (url: string) => void,
): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'code':
        return (
          <code key={key} className="ai-message__code">
            {node.text}
          </code>
        );
      case 'bold':
        return <strong key={key}>{node.text}</strong>;
      case 'italic':
        return <em key={key}>{node.text}</em>;
      case 'strike':
        return <s key={key}>{node.text}</s>;
      case 'link':
        return (
          <a
            key={key}
            href="#"
            className="ai-message__link"
            onClick={(event) => {
              event.preventDefault();
              onOpenLink(node.url);
            }}
          >
            {node.text}
          </a>
        );
      default:
        return <span key={key}>{node.text}</span>;
    }
  });
}

/** Renders one block of the answer. */
function renderBlock(
  block: ReturnType<typeof parseMarkdown>[number],
  key: string,
  onOpenLink: (url: string) => void,
): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, block.level))}` as 'h1';
      return <Tag key={key}>{renderInline(parseInline(block.text), key, onOpenLink)}</Tag>;
    }
    case 'paragraph':
      return (
        <p key={key}>{renderInline(parseInline(block.text), key, onOpenLink)}</p>
      );
    case 'code':
      return <CodeBlock key={key} language={block.language} code={block.code} />;
    case 'list':
      return block.ordered ? (
        <ol key={key}>
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>
              {renderInline(parseInline(item), `${key}-${index}`, onOpenLink)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>
              {renderInline(parseInline(item), `${key}-${index}`, onOpenLink)}
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote key={key}>
          {renderInline(parseInline(block.text), key, onOpenLink)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} />;
    case 'table':
      return (
        <table key={key} className="ai-message__table">
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={`${key}-h-${index}`}>
                  {renderInline(parseInline(cell), `${key}-h-${index}`, onOpenLink)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}-r-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${key}-r-${rowIndex}-${cellIndex}`}>
                    {renderInline(
                      parseInline(cell),
                      `${key}-r-${rowIndex}-${cellIndex}`,
                      onOpenLink,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return null;
  }
}

export function MessageList({
  messages,
  streaming,
  onOpenLink,
}: MessageListProps): React.JSX.Element {
  const handleOpenLink = useCallback(
    (url: string): void => {
      onOpenLink(url);
    },
    [onOpenLink],
  );

  if (messages.length === 0) {
    return (
      <div className="ai-messages ai-messages--empty">
        <p className="ai-messages__hint">
          Ask a question about the code, request an explanation, or attach a
          file as context.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-messages">
      {messages.map((message, index) => (
        <article
          key={`${message.role}-${index}`}
          className={`ai-message ai-message--${message.role}`}
        >
          <span className="ai-message__role">
            {message.role === 'user'
              ? 'You'
              : message.role === 'assistant'
                ? 'Assistant'
                : 'System'}
          </span>
          <div className="ai-message__content">
            {parseMarkdown(message.content).map((block, blockIndex) =>
              renderBlock(block, `m${index}-b${blockIndex}`, handleOpenLink),
            )}
            {message.attachments !== undefined &&
            message.attachments.length > 0 ? (
              <ul className="ai-message__attachments">
                {message.attachments.map((attachment) => (
                  <li key={attachment.path} className="ai-message__attachment">
                    {attachment.name}
                    {attachment.truncated ? ' (shortened)' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {streaming && index === messages.length - 1 ? (
              <span className="ai-message__cursor" aria-label="The answer is coming">
                ▍
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
