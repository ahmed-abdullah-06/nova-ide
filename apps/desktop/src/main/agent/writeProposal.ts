/**
 * Writing an accepted proposal (spec §12.1).
 *
 * The write goes through the file service of Milestone 2, so the same
 * limits and the same conflict detection apply:
 *
 *  - the path is resolved inside the workspace (symbolic links included),
 *  - the file must not have changed since the agent read it, otherwise a
 *    conflict is reported and NOTHING is written,
 *  - the content is limited like every other write.
 */
import type { AgentProposal } from '../../shared/agent-types';
import type { FileSystemService } from '../services/fileSystemService';
import { resolveInWorkspace } from '../services/pathSecurity';

/** The result of writing a proposal. */
export type WriteProposalResult =
  | { ok: true }
  | { ok: false; message: string; conflict?: boolean };

/**
 * Writes an accepted proposal to the disk.
 *
 * @param proposal The proposal that the user accepted.
 * @param root The canonical root of the workspace.
 * @param files The file service of the application.
 */
export async function writeProposal(
  proposal: AgentProposal,
  root: string | null,
  files: FileSystemService,
): Promise<WriteProposalResult> {
  if (root === null) {
    return { ok: false, message: 'No workspace is open.' };
  }
  const resolved = await resolveInWorkspace(root, proposal.path, {
    allowRoot: false,
  });
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }

  // The file must not have changed since the agent read it.
  if (proposal.expectedMtimeMs !== null) {
    const current = await files.readFile(resolved.value);
    if (current.ok) {
      if (
        Math.abs(current.value.mtimeMs - proposal.expectedMtimeMs) > 1
      ) {
        return {
          ok: false,
          conflict: true,
          message:
            'The file changed on disk since the agent read it. ' +
            'The change was not written.',
        };
      }
    }
  }

  const result = await files.writeFile(
    resolved.value,
    proposal.after,
    proposal.expectedMtimeMs,
  );
  if (!result.ok) {
    return {
      ok: false,
      conflict: result.code === 'CONFLICT',
      message: result.message,
    };
  }
  return { ok: true };
}
