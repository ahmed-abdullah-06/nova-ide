/**
 * Profile survival across the 10G product rename (spec §23 / V1 DoD).
 *
 * Renaming the product changes Electron's default userData directory. The
 * app pins it back to the legacy directory so settings, encrypted keys and
 * conversations are not stranded. These tests exercise the pure resolver
 * used at main-process startup.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PROFILE_NAME,
  resolveProfilePath,
} from '../../apps/desktop/src/main/config/profilePath';

describe('profile path after the product rename', () => {
  const appData = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming');

  it('uses the legacy directory for a default A6 launch', () => {
    const resolved = resolveProfilePath({
      userData: path.join(appData, 'A6'),
      appData,
      appName: 'A6',
      hasExplicitUserData: false,
    });
    expect(resolved).toBe(path.join(appData, LEGACY_PROFILE_NAME));
    expect(resolved).not.toBe(path.join(appData, 'A6'));
  });

  it('respects an explicit --user-data-dir (verification isolation)', () => {
    const profile = path.join('C:', 'Temp', 'isolated-profile');
    const resolved = resolveProfilePath({
      userData: profile,
      appData,
      appName: 'A6',
      hasExplicitUserData: true,
    });
    expect(resolved).toBe(profile);
  });

  it('respects a non-default override we did not create', () => {
    const override = path.join('D:', 'custom-profile');
    const resolved = resolveProfilePath({
      userData: override,
      appData,
      appName: 'A6',
      hasExplicitUserData: false,
    });
    expect(resolved).toBe(override);
  });

  it('is idempotent when the userData is already the legacy directory', () => {
    const legacy = path.join(appData, LEGACY_PROFILE_NAME);
    const resolved = resolveProfilePath({
      userData: legacy,
      appData,
      appName: 'A6',
      hasExplicitUserData: false,
    });
    expect(resolved).toBe(legacy);
  });

  it('keeps the legacy name stable across platforms', () => {
    expect(LEGACY_PROFILE_NAME).toBe('NOVA IDE');
  });
});
