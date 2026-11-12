/**
 * The review of a change proposal (spec §12.1, §13).
 *
 * The change is shown with the diff editor of Monaco: the content before
 * the change on the left, the content after the change on the right. The
 * user accepts or rejects every change; nothing is written before the
 * change is accepted.
 */
import { useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import type { AgentProposal } from '../../../shared/agent-types';
import { loadMonaco } from '../editor/monacoSetup';

export interface ProposalReviewProps {
  /** The proposal that is shown. */
  proposal: AgentProposal;
  /** Accepts the proposal (the file is written). */
  onAccept: () => void;
  /** Rejects the proposal (the file stays untouched). */
  onReject: () => void;
  /** True while the proposal is being written. */
  busy: boolean;
}

export function ProposalReview({
  proposal,
  onAccept,
  onReject,
  busy,
}: ProposalReviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let cancelled = false;
    let original: Monaco.editor.ITextModel | null = null;
    let modified: Monaco.editor.ITextModel | null = null;

    void loadMonaco()
      .then((monaco) => {
        if (cancelled || container === null) {
          return;
        }
        const language = languageOf(proposal.relativePath);
        original = monaco.editor.createModel(
          proposal.before,
          language,
        );
        modified = monaco.editor.createModel(proposal.after, language);
        const diffEditor = monaco.editor.createDiffEditor(container, {
          readOnly: true,
          renderSideBySide: true,
          automaticLayout: true,
          fontSize: 12,
          originalEditable: false,
          minimap: { enabled: false },
        });
        diffEditor.setModel({
          original: original,
          modified: modified,
        });
        editorRef.current = diffEditor;
      })
      .catch(() => {
        // Without Monaco the unified diff is shown as text.
        setError('The diff view is not available; the text diff is shown.');
      });

    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      editorRef.current = null;
      original?.dispose();
      modified?.dispose();
    };
  }, [proposal.id, proposal.before, proposal.after, proposal.relativePath]);

  return (
    <section className="agent-proposal">
      <header className="agent-proposal__header">
        <span className="agent-proposal__path">{proposal.relativePath}</span>
        <button
          type="button"
          className="agent-proposal__accept"
          onClick={onAccept}
          disabled={busy}
        >
          Accept
        </button>
        <button
          type="button"
          className="agent-proposal__reject"
          onClick={onReject}
          disabled={busy}
        >
          Reject
        </button>
      </header>
      {error !== null ? (
        <p className="agent-proposal__fallback" role="status">
          {error}
        </p>
      ) : null}
      <div className="agent-proposal__diff" ref={containerRef} />
      {error !== null ? (
        <pre className="agent-proposal__diff-text">{proposal.diff}</pre>
      ) : null}
    </section>
  );
}

/** The language of a file, derived from its extension. */
function languageOf(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    default:
      return 'plaintext';
  }
}
