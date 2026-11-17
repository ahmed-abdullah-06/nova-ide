import path from 'node:path';

/**
 * The profile directory name used by the product before the 10G rename.
 *
 * Electron derives its userData directory from the product name. Renaming the
 * product would therefore silently move the folder (`...\NOVA IDE` →
 * `...\A6`) and strand every setting, encrypted API key and conversation.
 * The app keeps using the old directory on purpose; the directory name is an
 * internal storage detail, not user-facing branding.
 */
export const LEGACY_PROFILE_NAME = 'NOVA IDE';

export interface ProfilePathInput {
  /** `app.getPath('userData')` for the current product name. */
  userData: string;
  /** `app.getPath('appData')` — platform application-data root. */
  appData: string;
  /** `app.getName()` — the current product name. */
  appName: string;
  /** `app.commandLine.hasSwitch('user-data-dir')`. */
  hasExplicitUserData: boolean;
}

/**
 * Resolves the userData path the app must use.
 *
 * - An explicit `--user-data-dir` (the verification harness) is always
 *   respected: a test run must never redirect to the real user profile.
 * - Any other non-default override is also left untouched.
 * - Otherwise the path derived from the new product name is replaced by the
 *   legacy one, so existing profiles survive the rename unchanged.
 */
export function resolveProfilePath(input: ProfilePathInput): string {
  if (input.hasExplicitUserData) {
    return input.userData;
  }
  const defaultPath = path.join(input.appData, input.appName);
  if (path.resolve(input.userData) !== path.resolve(defaultPath)) {
    // An override we did not create; do not second-guess it.
    return input.userData;
  }
  return path.join(input.appData, LEGACY_PROFILE_NAME);
}
