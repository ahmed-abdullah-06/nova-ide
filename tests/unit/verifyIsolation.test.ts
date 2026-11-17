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
  seedProviderAddress,
  userDataArgument,
} from '../../tools/verify/isolation.mjs';

describe('the isolation of the verification runs', () => {
  it('names the application like the desktop package', () => {
    expect(appName()).toBe('A6');
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

  it('fingerprints the legacy profile the app actually uses after 10G', () => {
    const userProfile = realUserDataPath();
    // After the rename the product name is A6, but the app pins userData to
    // the legacy NOVA IDE directory. The harness must fingerprint THAT path.
    if (userProfile !== null) {
      expect(userProfile.endsWith('NOVA IDE')).toBe(true);
      expect(appName()).toBe('A6');
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

describe('the verification never contacts a real service', () => {
  it('writes the address of the mock into the isolated profile', () => {
    const profile = createIsolatedProfile();
    try {
      const file = seedProviderAddress(profile.dir, 'http://127.0.0.1:55555');
      expect(file).toContain('providers.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        version: number;
        providers: {
          id: string;
          enabled: boolean;
          baseUrl: string;
          encryptedKey: string | null;
        }[];
      };
      expect(raw.version).toBe(1);
      const ollama = raw.providers.find((entry) => entry.id === 'ollama');
      expect(ollama?.baseUrl).toBe('http://127.0.0.1:55555');
      expect(ollama?.enabled).toBe(true);
      // The cloud provider stays off and has no key.
      const cloud = raw.providers.find(
        (entry) => entry.id === 'openai-compatible',
      );
      expect(cloud?.enabled).toBe(false);
      expect(cloud?.encryptedKey).toBeNull();
    } finally {
      profile.cleanup();
    }
  });

  it('never writes the default address of Ollama', () => {
    const profile = createIsolatedProfile();
    try {
      const file = seedProviderAddress(profile.dir, 'http://127.0.0.1:55555');
      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain('127.0.0.1:11434');
    } finally {
      profile.cleanup();
    }
  });

  it('the harness seeds the profile before it starts the application', () => {
    const text = readFileSync('tools/verify/runtime.mjs', 'utf8');
    const seed = text.indexOf('seedProviderAddress(');
    const start = text.indexOf('const app = startApp(');
    expect(seed).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    // The address must be written before the application is started.
    expect(seed).toBeLessThan(start);
    // The mock must be started before the profile is seeded.
    expect(text.indexOf('const mockOllama = await startMockOllama()')).toBeLessThan(
      seed,
    );
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
