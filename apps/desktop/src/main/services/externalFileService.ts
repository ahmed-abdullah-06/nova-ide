/**
 * Native Open File dialog and grant-scoped access to files outside the
 * workspace (A6).
 *
 * The renderer never supplies a path: it asks for the dialog, then reads and
 * saves through the opaque grant id returned for an external selection. Files
 * inside the workspace are classified as such and keep using the existing
 * workspace-scoped channels. `pathSecurity` is not weakened — grants are an
 * explicit, main-process-only authorization for one canonical file.
 */
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import type {
  FileContent,
  FsResult,
  OpenFileSelection,
  SaveReceipt,
} from '../../shared/ipc-types';
import { ExternalFileGrants } from './externalFileGrants';
import type { FileSystemService } from './fileSystemService';
import { relateToRoot, resolveMainProcessFile } from './pathSecurity';
import { fsOk } from './results';

export class ExternalFileService {
  /** Owned here so no other module can issue or read a grant. */
  private readonly grants = new ExternalFileGrants();

  constructor(
    private readonly files: FileSystemService,
    private readonly getRoot: () => string | null,
  ) {}

  /** Shows the native dialog and returns renderer-safe metadata only. */
  async open(): Promise<FsResult<OpenFileSelection | null>> {
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      title: 'Open File',
    };
    const window =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const chosen =
      window === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    if (chosen.canceled) {
      return fsOk(null);
    }
    const selected = chosen.filePaths[0];
    if (selected === undefined) {
      return fsOk(null);
    }

    // The dialog path is main-process-owned, but canonicalise it anyway so a
    // symlink cannot turn an "inside" pick into an outside write (or vice
    // versa). The renderer only ever sees the canonical result.
    const canonical = await resolveMainProcessFile(selected);
    if (!canonical.ok) {
      return canonical;
    }
    const name = path.basename(canonical.value);
    const root = this.getRoot();
    if (root !== null && relateToRoot(root, canonical.value) !== 'outside') {
      return fsOk({ path: canonical.value, name, origin: 'workspace' });
    }
    const grantId = this.grants.issue(canonical.value);
    return fsOk({
      path: canonical.value,
      name,
      origin: 'external',
      grantId,
    });
  }

  /** Reads exactly the canonical path bound to the supplied grant. */
  async read(grantId: string): Promise<FsResult<FileContent>> {
    const granted = await this.grants.resolve(grantId);
    if (!granted.ok) {
      return granted;
    }
    // Internal helper: the caller has already verified the canonical path.
    return this.files.readCanonical(granted.value);
  }

  /** Saves through the grant; the renderer never supplies a path. */
  async write(
    grantId: string,
    content: string,
    expectedMtimeMs: number | null,
  ): Promise<FsResult<SaveReceipt>> {
    const granted = await this.grants.resolve(grantId);
    if (!granted.ok) {
      return granted;
    }
    return this.files.writeCanonical(granted.value, content, expectedMtimeMs);
  }
}
