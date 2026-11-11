/**
 * Packaging helper for the native terminal module (spec §17, §19).
 *
 * The Electron Forge Vite plugin copies only the Vite build output
 * (`.vite/`) into the packaged application, so the `node-pty` runtime — a
 * native module that must stay a real file on disk — would be missing.
 *
 * This hook copies the installed `node-pty` package into the packaged
 * application. The `asar.unpack` rule in `forge.config.mts` then extracts
 * the native binaries to `app.asar.unpacked`, where Electron can load them
 * (a native module cannot be `dlopen()`ed from inside an ASAR archive).
 *
 * The module is loaded through `createRequire` in the main process, so it
 * is resolved as a normal CommonJS dependency of the packaged app.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Files and folders of the native module that are not needed at runtime. */
const EXCLUDED_ENTRIES = new Set([
  // Debug symbols (several megabytes each).
  '*.pdb',
  // Sources and build inputs — only needed to compile the module.
  'src',
  'deps',
  'scripts',
  'binding.gyp',
  'Makefile',
  'README.md',
  'LICENSE',
  'tsconfig.json',
  'package-lock.json',
]);

/**
 * Copies the native terminal module into the packaged application.
 *
 * @param options The packager hook arguments; `buildPath` is the staging
 *   directory of the packaged application (`resources/app`).
 */
export async function copyNativeTerminalModule({
  buildPath,
}: {
  buildPath: string;
}): Promise<void> {
  let source: string;
  try {
    // Resolve the installed package (works from the workspace root and
    // from the desktop package).
    source = path.dirname(require.resolve('node-pty/package.json'));
  } catch (error) {
    console.error(
      '[packaging] node-pty could not be resolved; the terminal will not work:',
      error,
    );
    return;
  }

  const target = path.join(buildPath, 'node_modules', 'node-pty');
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (entry: string) => {
      const name = path.basename(entry);
      if (name.endsWith('.pdb')) {
        return false;
      }
      return !EXCLUDED_ENTRIES.has(name);
    },
  });
  console.log('[packaging] copied the native terminal module into the app');
}
