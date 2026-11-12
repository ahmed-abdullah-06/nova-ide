/**
 * Type declarations for the isolation helper of the verification
 * harness (the module itself is plain JavaScript, so it can be started
 * with `node` without a build step).
 */

/** The name of the application (the product name of the desktop package). */
export function appName(): string;

/**
 * The directory the application uses for its data when it is started
 * without an isolated profile.
 */
export function realUserDataPath(): string | null;

/** A temporary profile directory and the function that removes it. */
export interface IsolatedProfile {
  /** The directory of the profile. */
  dir: string;
  /** Removes the directory. */
  cleanup(): void;
}

/** Creates a temporary profile directory for the application. */
export function createIsolatedProfile(): IsolatedProfile;

/**
 * A fingerprint of the files of a profile (the content of the settings
 * and of the conversations).
 */
export function profileFingerprint(dir: string | null): string;

/** The command line argument that isolates the profile of the application. */
export function userDataArgument(dir: string): string;
