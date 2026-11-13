/**
 * The revert of a checkpoint (spec §12.1, M5 C1).
 *
 * A revert must never overwrite a newer edit silently:
 *
 *  - the current content of the disk is compared with the content the run
 *    wrote,
 *  - a file with unsaved changes in an editor buffer is a conflict too,
 *  - a conflict is only reverted when the user confirmed THAT file,
 *  - a file that becomes a conflict between the preview and the write is
 *    skipped and kept in the checkpoint, so the user can try again.
 *
 * The module is pure with respect to the file service: the service reads
 * and writes through the same boundary as every other file operation.
 */
import path from 'node:path';
import type {
  AgentRevertConflict,
  AgentRevertFile,
  AgentRevertPreview,
  AgentRevertResult,
} from '../../shared/agent-types';
import type { FileSystemService } from '../services/fileSystemService';
import type { AgentCheckpoint } from './proposalStore';

/** One file of a revert, with the metadata that is not exposed to the UI. */
export interface RevertFileState extends AgentRevertFile {
  /** The mtime of the disk at the moment of the preview. */
  currentMtimeMs: number | null;
}

/** The internal preview (the UI only sees {@link AgentRevertPreview}). */
export interface RevertPreviewState {
  runId: string;
  files: RevertFileState[];
}

/** True when two paths name the same file (case-insensitive on Windows). */
export function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/** The path shown to the user. */
function relativePathOf(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.length === 0 ? file : relative;
}

/** Reads a file without failing the whole preview. */
async function readFileContent(
  files: FileSystemService,
  file: string,
): Promise<{ content: string; mtimeMs: number } | null> {
  const current = await files.readFile(file);
  return current.ok
    ? { content: current.value.content, mtimeMs: current.value.mtimeMs }
    : null;
}

/**
 * Builds the preview of a revert.
 *
 * @param checkpoint The checkpoint of the run.
 * @param root The canonical root of the workspace.
 * @param dirtyPaths The files with unsaved changes in an editor.
 * @param files The file service of the application.
 */
export async function previewRevert(
  checkpoint: AgentCheckpoint,
  root: string,
  dirtyPaths: readonly string[],
  files: FileSystemService,
): Promise<RevertPreviewState> {
  const out: RevertFileState[] = [];
  for (const file of checkpoint.files) {
    const dirty = dirtyPaths.some((dirtyPath) => samePath(dirtyPath, file.path));
    const base = {
      path: file.path,
      relativePath: relativePathOf(root, file.path),
      action: file.content === null ? ('delete' as const) : ('restore' as const),
    };

    if (dirty) {
      out.push({
        ...base,
        conflict: 'dirty-buffer',
        currentMtimeMs: null,
      });
      continue;
    }

    const current = await readFileContent(files, file.path);
    if (current === null) {
      // A file the run created and that is already gone is safe to
      // "restore"; a file that should be restored is missing on disk.
      out.push({
        ...base,
        conflict: file.content === null ? null : 'changed-on-disk',
        currentMtimeMs: null,
      });
      continue;
    }

    const conflict = conflictWithCurrent(file.after, current.content);
    out.push({ ...base, conflict, currentMtimeMs: current.mtimeMs });
  }
  return { runId: checkpoint.runId, files: out };
}

/** Compares the content the run wrote with the current content. */
function conflictWithCurrent(
  after: string | null | undefined,
  current: string,
): AgentRevertConflict | null {
  // A checkpoint of an older version has no recorded "after" content:
  // the revert asks for a confirmation instead of guessing.
  if (after === undefined) {
    return 'changed-on-disk';
  }
  if (after === null) {
    return null;
  }
  return current === after ? null : 'changed-on-disk';
}

/** Removes the internal metadata from a preview. */
export function publicPreview(preview: RevertPreviewState): AgentRevertPreview {
  return {
    runId: preview.runId,
    files: preview.files.map((file) => ({
      path: file.path,
      relativePath: file.relativePath,
      action: file.action,
      conflict: file.conflict,
    })),
  };
}

/**
 * Applies a revert.
 *
 * Only the paths the user confirmed are forced; every other conflict is
 * skipped and stays in the checkpoint.
 *
 * @param checkpoint The checkpoint of the run.
 * @param preview The preview that was shown to the user.
 * @param confirmedPaths The files for which the user accepted the overwrite.
 * @param files The file service of the application.
 */
export async function applyRevert(
  checkpoint: AgentCheckpoint,
  preview: RevertPreviewState,
  confirmedPaths: readonly string[],
  files: FileSystemService,
): Promise<AgentRevertResult> {
  let restored = 0;
  const skipped: AgentRevertFile[] = [];

  for (const file of preview.files) {
    const entry = checkpoint.files.find((candidate) =>
      samePath(candidate.path, file.path),
    );
    if (entry === undefined) {
      continue;
    }
    const confirmed = confirmedPaths.some((candidate) =>
      samePath(candidate, file.path),
    );
    if (file.conflict !== null && !confirmed) {
      skipped.push(toPublicFile(file));
      continue;
    }

    if (entry.content === null) {
      // The run created the file: the revert removes it. It is read once
      // more, so a change after the preview is not deleted silently.
      const current = await readFileContent(files, file.path);
      if (current === null) {
        restored += 1;
        continue;
      }
      if (
        !confirmed &&
        entry.after !== undefined &&
        entry.after !== null &&
        current.content !== entry.after
      ) {
        skipped.push({ ...toPublicFile(file), conflict: 'changed-on-disk' });
        continue;
      }
      const result = await files.delete(file.path);
      if (result.ok) {
        restored += 1;
      } else {
        skipped.push(toPublicFile(file));
      }
      continue;
    }

    // A confirmed conflict is an explicit overwrite; a safe file uses the
    // mtime of the preview, so a write that becomes stale is refused.
    const expected = file.conflict !== null ? null : file.currentMtimeMs;
    const result = await files.writeFile(file.path, entry.content, expected);
    if (result.ok) {
      restored += 1;
    } else {
      skipped.push({
        ...toPublicFile(file),
        conflict: 'changed-on-disk',
      });
    }
  }

  return { restored, skipped };
}

/** The public shape of one file. */
function toPublicFile(file: RevertFileState): AgentRevertFile {
  return {
    path: file.path,
    relativePath: file.relativePath,
    action: file.action,
    conflict: file.conflict,
  };
}
