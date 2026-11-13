/**
 * The diff view of a proposal (spec §12.1, M5 C4).
 *
 * The view is mounted outside of React so the fallback is testable: when
 * Monaco cannot be loaded (a missing chunk, a broken worker, a slow
 * network) the review keeps working with the plain unified diff.
 */
import type * as Monaco from 'monaco-editor';
import type { AgentProposal } from '../../../shared/agent-types';

/** The module of Monaco (the loader is injected, so tests need no bundle). */
type MonacoModule = typeof Monaco;

/** Loads Monaco. */
export type MonacoLoader = () => Promise<MonacoModule>;

/** The message shown when the rich diff is not available. */
export const PROPOSAL_DIFF_FALLBACK_MESSAGE =
  'The diff view is not available; the text diff is shown.';

/** A mounted diff view. */
export interface MountedProposalDiff {
  ok: true;
  /** Disposes the editor and the models. */
  dispose: () => void;
}

/** The fallback of a diff view that could not be mounted. */
export interface ProposalDiffFallback {
  ok: false;
  /** The explanation for the user. */
  message: string;
  /** The unified diff that is shown instead. */
  diff: string;
}

export type ProposalDiffResult = MountedProposalDiff | ProposalDiffFallback;

/** The part of a proposal the diff view needs. */
export type DiffableProposal = Pick<
  AgentProposal,
  'before' | 'after' | 'diff' | 'relativePath'
>;

/**
 * Mounts the editable diff of a proposal.
 *
 * Every failure — a rejected loader, a model that cannot be created, a
 * missing DOM node — is turned into the text fallback; the user can
 * always accept or reject the change.
 */
export async function mountProposalDiff(
  container: unknown,
  proposal: DiffableProposal,
  loadMonaco: MonacoLoader,
): Promise<ProposalDiffResult> {
  let original: Monaco.editor.ITextModel | null = null;
  let modified: Monaco.editor.ITextModel | null = null;
  let editor: Monaco.editor.IStandaloneDiffEditor | null = null;

  try {
    const monaco = await loadMonaco();
    const language = languageOf(proposal.relativePath);
    original = monaco.editor.createModel(proposal.before, language);
    modified = monaco.editor.createModel(proposal.after, language);
    editor = monaco.editor.createDiffEditor(container as never, {
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      fontSize: 12,
      originalEditable: false,
      minimap: { enabled: false },
    });
    editor.setModel({ original, modified });

    return {
      ok: true,
      dispose: () => {
        editor?.dispose();
        editor = null;
        original?.dispose();
        original = null;
        modified?.dispose();
        modified = null;
      },
    };
  } catch {
    editor?.dispose();
    original?.dispose();
    modified?.dispose();
    return {
      ok: false,
      message: PROPOSAL_DIFF_FALLBACK_MESSAGE,
      diff: proposal.diff,
    };
  }
}

/** The language of a file, derived from its extension. */
export function languageOf(filePath: string): string {
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
