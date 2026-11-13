/**
 * The review of a change proposal (spec §12.1, §13).
 *
 * The change is shown with the diff editor of Monaco: the content before
 * the change on the left, the content after the change on the right. The
 * user accepts or rejects every change; nothing is written before the
 * change is accepted.
 */
import { useEffect, useRef, useState } from 'react';
import type { AgentProposal } from '../../../shared/agent-types';
import { loadMonaco } from '../editor/monacoSetup';
import {
  mountProposalDiff,
  type MountedProposalDiff,
} from './proposalDiff';

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
  const mountRef = useRef<MountedProposalDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let cancelled = false;
    setError(null);

    void mountProposalDiff(container, proposal, loadMonaco).then((mounted) => {
      if (cancelled) {
        if (mounted.ok) {
          mounted.dispose();
        }
        return;
      }
      if (mounted.ok) {
        mountRef.current = mounted;
      } else {
        setError(mounted.message);
      }
    });

    return () => {
      cancelled = true;
      mountRef.current?.dispose();
      mountRef.current = null;
    };
  }, [
    proposal.id,
    proposal.before,
    proposal.after,
    proposal.diff,
    proposal.relativePath,
  ]);

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
