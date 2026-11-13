/**
 * The change proposals of an agent run (spec §12.1, §13).
 *
 * A proposal is a change the agent wants to make. It is NEVER written to
 * the disk before the user accepts it — the agent only prepares it.
 *
 * Every accepted change is recorded in a checkpoint, so the user can
 * revert the whole run later. The checkpoints live in the application
 * data directory and are capped.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentProposal } from '../../shared/agent-types';
import { unifiedDiff } from './diff';

/** The name of the directory with the checkpoints. */
const CHECKPOINT_DIR = 'agent-checkpoints';

/** The maximum number of checkpoints that are kept. */
const MAX_CHECKPOINTS = 20;

/** One checkpoint: the content of the files before and after a run. */
export interface AgentCheckpoint {
  /** The id of the run. */
  runId: string;
  /** The files of the checkpoint (the content before the run). */
  files: AgentCheckpointFile[];
  /** The time of the checkpoint. */
  createdAt: number;
}

/** One file of a checkpoint. */
export interface AgentCheckpointFile {
  /** The absolute path of the file. */
  path: string;
  /** The content before the run changed it (null when it did not exist). */
  content: string | null;
  /**
   * The content the run wrote (the conflict check of a revert).
   *
   * A revert refuses to overwrite a file whose current content is not
   * this value: the user edited it after the run.
   */
  after?: string | null;
}

export class ProposalStore {
  /** The proposals of the runs, by run id. */
  private readonly proposals = new Map<string, Map<string, AgentProposal>>();
  /** The checkpoints of the runs, by run id. */
  private readonly checkpoints = new Map<string, AgentCheckpoint>();

  /** Creates a proposal for a run. */
  create(
    runId: string,
    input: {
      path: string;
      relativePath: string;
      before: string;
      after: string;
      expectedMtimeMs: number | null;
      created: boolean;
    },
  ): AgentProposal {
    const proposal: AgentProposal = {
      id: `proposal-${randomUUID()}`,
      runId,
      path: input.path,
      relativePath: input.relativePath,
      before: input.before,
      after: input.after,
      diff: unifiedDiff(
        input.before,
        input.after,
        input.relativePath,
        input.relativePath,
      ),
      expectedMtimeMs: input.expectedMtimeMs,
      created: input.created,
      createdAt: Date.now(),
    };
    const run = this.proposals.get(runId) ?? new Map<string, AgentProposal>();
    run.set(proposal.id, proposal);
    this.proposals.set(runId, run);
    return proposal;
  }

  /** The proposals of a run. */
  list(runId: string): AgentProposal[] {
    return [...(this.proposals.get(runId)?.values() ?? [])];
  }

  /** One proposal of a run (undefined when it does not exist). */
  get(runId: string, proposalId: string): AgentProposal | undefined {
    return this.proposals.get(runId)?.get(proposalId);
  }

  /** Removes a proposal from the list of a run. */
  remove(runId: string, proposalId: string): void {
    this.proposals.get(runId)?.delete(proposalId);
  }

  /** Removes every proposal of a run. */
  clear(runId: string): void {
    this.proposals.delete(runId);
  }

  /**
   * Records the state of the files of a run, so the run can be reverted.
   *
   * @param runId The run.
   * @param files The files and their content before the run changed them.
   */
  async checkpoint(
    runId: string,
    files: AgentCheckpointFile[],
  ): Promise<void> {
    const checkpoint: AgentCheckpoint = {
      runId,
      files,
      createdAt: Date.now(),
    };
    this.checkpoints.set(runId, checkpoint);
    await this.writeCheckpoint(checkpoint);
  }

  /**
   * Adds a file to the checkpoint of a run.
   *
   * The content of a file is kept only once: the first recorded state is
   * the state before the run changed the file, so a revert restores the
   * original content and not an intermediate one.
   *
   * @param runId The run.
   * @param file The path of the file, its content before the change
   *   (null when the file did not exist) and the content the run wrote.
   */
  async addToCheckpoint(
    runId: string,
    file: AgentCheckpointFile,
  ): Promise<void> {
    const existing = this.checkpoints.get(runId);
    if (
      existing !== undefined &&
      existing.files.some((entry) => entry.path === file.path)
    ) {
      // The file was already changed by this run: the state that was
      // recorded first is the one before the run touched it.
      return;
    }
    const files = existing === undefined ? [] : [...existing.files];
    files.push(file);
    await this.checkpoint(runId, files);
  }

  /** The checkpoint of a run (undefined when there is none). */
  checkpointOf(runId: string): AgentCheckpoint | undefined {
    return this.checkpoints.get(runId);
  }

  /**
   * Forgets the checkpoint of a run.
   *
   * The files of the checkpoint are removed from the disk as well.
   */
  async forget(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
    await this.removeCheckpointFiles(runId);
  }

  /**
   * Reverts the files of a run to the state of the checkpoint.
   *
   * @returns The paths of the files that were restored.
   */
  async revert(runId: string): Promise<string[]> {
    const checkpoint = this.checkpoints.get(runId);
    if (checkpoint === undefined) {
      return [];
    }
    const restored: string[] = [];
    for (const file of checkpoint.files) {
      try {
        if (file.content === null) {
          await fs.rm(file.path, { force: true });
        } else {
          await fs.writeFile(file.path, file.content, 'utf8');
        }
        restored.push(file.path);
      } catch (error) {
        console.error(
          '[agent] a file of the checkpoint could not be restored:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
    }
    this.checkpoints.delete(runId);
    await this.removeCheckpointFiles(runId);
    return restored;
  }

  /** Removes every checkpoint of the application (the cap). */
  async prune(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.checkpointDir);
    } catch {
      return;
    }
    const sorted = entries.sort();
    while (sorted.length > MAX_CHECKPOINTS) {
      const oldest = sorted.shift();
      if (oldest === undefined) {
        break;
      }
      await fs.rm(path.join(this.checkpointDir, oldest), {
        recursive: true,
        force: true,
      });
    }
  }

  /** The directory of the checkpoints. */
  private get checkpointDir(): string {
    return path.join(app.getPath('userData'), CHECKPOINT_DIR);
  }

  /** Writes the checkpoint to the disk. */
  private async writeCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    try {
      const dir = path.join(this.checkpointDir, checkpoint.runId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'checkpoint.json'),
        JSON.stringify(checkpoint),
        'utf8',
      );
      await this.prune();
    } catch (error) {
      console.error(
        '[agent] the checkpoint could not be written:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }

  /** Removes the files of a checkpoint. */
  private async removeCheckpointFiles(runId: string): Promise<void> {
    try {
      await fs.rm(path.join(this.checkpointDir, runId), {
        recursive: true,
        force: true,
      });
    } catch {
      // The checkpoint is best effort.
    }
  }
}
