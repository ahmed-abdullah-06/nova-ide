/**
 * Isolation of the verification runs (spec §24).
 *
 * The harness starts the real application. Without an isolated profile
 * the application would use the profile of the user: the settings of
 * the providers, the API keys and the conversations of the user would
 * be read and written by a test run.
 *
 * Every run therefore gets its own, temporary profile directory
 * (`--user-data-dir`), which is deleted afterwards. The harness also
 * compares the profile of the user before and after the run, so a
 * regression that touches it is reported instead of going unnoticed.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** The files of a profile that a test run must never touch. */
const PROFILE_FILES = [
  'providers.json',
  'conversations.json',
  'recent-workspaces.json',
];

/** The name of the application (the product name of the desktop package). */
export function appName() {
  try {
    const raw = readFileSync(
      path.join(REPO, 'apps', 'desktop', 'package.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw);
    return typeof parsed.productName === 'string' ? parsed.productName : 'NOVA IDE';
  } catch {
    return 'NOVA IDE';
  }
}

/**
 * The directory the application uses for its data when it is started
 * without an isolated profile.
 *
 * @returns The path, or null when it cannot be determined.
 */
export function realUserDataPath() {
  const name = appName();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData === undefined ? null : path.join(appData, name);
  }
  if (process.platform === 'darwin') {
    const home = process.env.HOME;
    return home === undefined
      ? null
      : path.join(home, 'Library', 'Application Support', name);
  }
  const home = process.env.HOME;
  if (home === undefined) {
    return null;
  }
  const config =
    process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return path.join(config, name);
}

/**
 * Creates a temporary profile directory for the application.
 *
 * @returns The directory and a function that deletes it.
 */
export function createIsolatedProfile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'nova-verify-profile-'));
  return {
    dir,
    cleanup() {
      try {
        rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch {
        // A file that is still locked is removed by the operating system
        // later; the directory is temporary anyway.
      }
    },
  };
}

/**
 * A fingerprint of the files of a profile.
 *
 * The content is used (and not the time), so a run that only reads the
 * profile does not change the fingerprint.
 *
 * @param dir The profile directory (null when it is unknown).
 * @returns The fingerprint.
 */
export function profileFingerprint(dir) {
  if (dir === null || !existsSync(dir)) {
    return 'missing';
  }
  return PROFILE_FILES.map((name) => {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      return `${name}:missing`;
    }
    try {
      return `${name}:${readFileSync(file, 'utf8')}`;
    } catch {
      return `${name}:unreadable`;
    }
  }).join('|');
}

/** The command line argument that isolates the profile of the application. */
export function userDataArgument(dir) {
  return `--user-data-dir=${dir}`;
}
