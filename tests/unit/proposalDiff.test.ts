/**
 * Tests for the diff view of a proposal (spec §12.1, M5 C4).
 *
 * Monaco is injected, so the tests cover both the normal mount and the
 * failure path without loading the editor or a DOM.
 */
import { describe, expect, it, vi } from 'vitest';import {
  languageOf,
  mountProposalDiff,
  PROPOSAL_DIFF_FALLBACK_MESSAGE,
  type DiffableProposal,
} from '../../apps/desktop/src/renderer/features/agent/proposalDiff';

const PROPOSAL: DiffableProposal = {
  before: 'const a = 1;\n',
  after: 'const a = 2;\n',
  diff: '--- a/a.ts\n+++ b/a.ts\n-const a = 1;\n+const a = 2;\n',
  relativePath: 'src/a.ts',
};

/** A fake Monaco module that records what happened. */
function fakeMonaco(options: { failEditor?: boolean } = {}) {
  const disposed: string[] = [];
  const editor = {
    createModel: (content: string) => ({
      content,
      dispose: () => disposed.push(`model:${content}`),
    }),
    createDiffEditor: () => {
      if (options.failEditor === true) {
        throw new Error('the editor could not be created');
      }
      return {
        setModel: vi.fn(),
        dispose: () => disposed.push('editor'),
      };
    },
  };
  return { monaco: { editor } as never, disposed };
}

describe('the diff view of a proposal', () => {
  it('mounts Monaco and disposes everything', async () => {
    const { monaco, disposed } = fakeMonaco();
    const container = {};
    const mounted = await mountProposalDiff(
      container,
      PROPOSAL,
      async () => monaco,
    );
    expect(mounted.ok).toBe(true);
    if (mounted.ok) {
      mounted.dispose();
    }
    expect(disposed).toContain('editor');
    expect(disposed).toContain('model:const a = 1;\n');
    expect(disposed).toContain('model:const a = 2;\n');
  });

  it('shows the text diff when Monaco cannot be loaded', async () => {
    const container = {};
    const mounted = await mountProposalDiff(container, PROPOSAL, async () => {
      throw new Error('the chunk could not be loaded');
    });
    expect(mounted.ok).toBe(false);
    if (!mounted.ok) {
      expect(mounted.message).toBe(PROPOSAL_DIFF_FALLBACK_MESSAGE);
      expect(mounted.diff).toBe(PROPOSAL.diff);
    }
  });

  it('shows the text diff when the editor cannot be created', async () => {
    const { monaco, disposed } = fakeMonaco({ failEditor: true });
    const container = {};
    const mounted = await mountProposalDiff(
      container,
      PROPOSAL,
      async () => monaco,
    );
    expect(mounted.ok).toBe(false);
    // The models that were already created are cleaned up.
    expect(disposed).toContain('model:const a = 1;\n');
    expect(disposed).toContain('model:const a = 2;\n');
  });

  it('derives the language of the file', () => {
    expect(languageOf('a.ts')).toBe('typescript');
    expect(languageOf('a.json')).toBe('json');
    expect(languageOf('a.unknown')).toBe('plaintext');
  });
});
