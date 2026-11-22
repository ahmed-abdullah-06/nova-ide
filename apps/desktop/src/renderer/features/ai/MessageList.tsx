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
import { Icon } from '../../components/ui/icons';
import { IconButton } from '../../components/ui/IconButton';
import { CodeBlock } from './CodeBlock';
import { parseInline, parseMarkdown, type InlineNode } from './markdown';

export interface MessageListProps {
  /** The messages of the conversation. */
  messages: readonly ChatMessage[];
  /** True while an answer is still coming in. */
  streaming: boolean;
  /** Opens a link in the browser of the user. */
  onOpenLink: (url: string) => void;
  /** Reads the answer of that index aloud (Milestone 8C). */
  onReadAloud?: (text: string, index: number) => void;
  /** The index of the answer that is being spoken (null otherwise). */
  speakingIndex?: number | null;
  /** Stops the speech at once. */
  onStopSpeech?: () => void;
  /** Regenerates the last assistant answer (icon action on that message). */
  onRegenerate?: () => void;
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
  onReadAloud,
  speakingIndex = null,
  onStopSpeech,
  onRegenerate,
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

  let lastAssistantIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      lastAssistantIndex = index;
    }
  });

  return (
    <div className="ai-messages">
      {messages.map((message, index) => (
        <article
          key={`${message.role}-${index}`}
          className={`ai-message ai-message--${message.role}`}
        >
          <div className="ai-message__header">
            <span className="ai-message__role">
              {message.role === 'user'
                ? 'You'
                : message.role === 'assistant'
                  ? 'Assistant'
                  : 'System'}
            </span>
            <div className="ai-message__actions">
              {message.role === 'assistant' &&
              onRegenerate !== undefined &&
              index === lastAssistantIndex &&
              !streaming &&
              message.content.trim().length > 0 ? (
                <IconButton
                  label="Regenerate answer"
                  className="ai-message__regenerate"
                  icon={<Icon name="regenerate" size={13} />}
                  size="sm"
                  onClick={onRegenerate}
                />
              ) : null}
              {message.role === 'assistant' &&
              onReadAloud !== undefined &&
              !(streaming && index === messages.length - 1) &&
              message.content.trim().length > 0 ? (
                <button
                  type="button"
                  className="ai-message__read"
                  aria-pressed={speakingIndex === index}
                  onClick={() => {
                    if (speakingIndex === index) {
                      onStopSpeech?.();
                      return;
                    }
                    onReadAloud(message.content, index);
                  }}
                  title={
                    speakingIndex === index
                      ? 'Stop reading the answer aloud'
                      : 'Read the answer aloud (code blocks are skipped by default)'
                  }
                >
                  {speakingIndex === index ? 'Stop reading' : 'Read aloud'}
                </button>
              ) : null}
            </div>
          </div>
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
