/**
 * Tests for the isolation of the verification runs (spec §24).
 *
 * The harness starts the real application. It must always use an
 * isolated profile, so a test run never reads or writes the settings,
 * the API keys or the conversations of the user.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appName,
  createIsolatedProfile,
  profileFingerprint,
  realUserDataPath,
  userDataArgument,
} from '../../tools/verify/isolation.mjs';

describe('the isolation of the verification runs', () => {
  it('names the application like the desktop package', () => {
    expect(appName()).toBe('NOVA IDE');
  });

  it('creates a temporary profile directory', () => {
    const profile = createIsolatedProfile();
    try {
      expect(existsSync(profile.dir)).toBe(true);
      expect(profile.dir).toContain('nova-verify-profile-');
    } finally {
      profile.cleanup();
    }
  });

  it('removes the temporary profile directory', () => {
    const profile = createIsolatedProfile();
    profile.cleanup();
    expect(existsSync(profile.dir)).toBe(false);
  });

  it('passes the profile to the application', () => {
    const profile = createIsolatedProfile();
    try {
      expect(userDataArgument(profile.dir)).toBe(
        `--user-data-dir=${profile.dir}`,
      );
    } finally {
      profile.cleanup();
    }
  });

  it('finds the profile of the user', () => {
    const userProfile = realUserDataPath();
    // The path depends on the platform; it must at least end with the
    // name of the application.
    if (userProfile !== null) {
      expect(userProfile.endsWith('NOVA IDE')).toBe(true);
    }
  });

  it('notices a change of the profile of the user', () => {
    const profile = createIsolatedProfile();
    try {
      const before = profileFingerprint(profile.dir);
      // A file that does not exist is part of the fingerprint.
      writeFileSync(
        `${profile.dir}/providers.json`,
        '{"version":1,"providers":[]}',
        'utf8',
      );
      const after = profileFingerprint(profile.dir);
      expect(after).not.toBe(before);
    } finally {
      profile.cleanup();
    }
  });

  it('reports a profile that does not exist', () => {
    expect(profileFingerprint(null)).toBe('missing');
    expect(profileFingerprint('C:\\does\\not\\exist')).toBe('missing');
  });
});

describe('the harness starts the application with an isolated profile', () => {
  /** The source of a harness script. */
  const source = (name: string): string =>
    readFileSync(`tools/verify/${name}`, 'utf8');

  it('the runtime harness uses an isolated profile', () => {
    const text = source('runtime.mjs');
    expect(text).toContain('createIsolatedProfile');
    expect(text).toContain('userDataArgument(');
    expect(text).toContain('profile.cleanup()');
  });

  it('the crash check uses an isolated profile', () => {
    const text = source('quitcleanup.mjs');
    expect(text).toContain('createIsolatedProfile');
    expect(text).toContain('userDataArgument(');
    expect(text).toContain('profile.cleanup()');
  });

  it('both harnesses check the profile of the user', () => {
    for (const name of ['runtime.mjs', 'quitcleanup.mjs']) {
      const text = source(name);
      expect(text).toContain('profileFingerprint(userProfile)');
      expect(text).toContain('fingerprintBefore');
      expect(text).toContain('fingerprintAfter');
    }
  });
});
