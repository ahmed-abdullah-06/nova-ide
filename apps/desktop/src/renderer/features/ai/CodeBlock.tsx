/**
 * A code block of the answer of a model (spec §6.1).
 *
 * The code is highlighted with Monaco (the application already loads it
 * for the editor). Monaco colorizes the element in place, so no markup of
 * the model is ever inserted into the document — React renders the text
 * and Monaco only adds the highlighting spans.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMonaco } from '../editor/monacoSetup';

export interface CodeBlockProps {
  /** The language of the code (as written in the fence). */
  language: string;
  /** The code itself. */
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps): React.JSX.Element {
  const codeRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const element = codeRef.current;
    if (element === null) {
      return;
    }
    let cancelled = false;
    void loadMonaco()
      .then((monaco) => {
        if (cancelled || element === null) {
          return;
        }
        element.setAttribute('data-lang', language.length > 0 ? language : 'plaintext');
        void monaco.editor.colorizeElement(element, {}).catch(() => {
          // The plain code stays visible when the highlighting fails.
        });
      })
      .catch(() => {
        // The plain code stays visible when Monaco is not available.
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const handleCopy = useCallback((): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }, [code]);

  return (
    <div className="ai-code">
      <div className="ai-code__header">
        <span className="ai-code__language">
          {language.length > 0 ? language : 'text'}
        </span>
        <button
          type="button"
          className="ai-code__copy"
          onClick={handleCopy}
          title="Copy the code"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="ai-code__body">
        {/* The key makes React create a fresh element for a new code, so
            the spans of Monaco never conflict with the text of React. */}
        <code key={code} ref={codeRef} data-lang={language}>
          {code}
        </code>
      </pre>
    </div>
  );
}
