/**
 * Tests for the credentials and the privacy gate (spec §11.4, §19.5).
 *
 * The credential store needs Electron's `safeStorage`, so it is mocked
 * here: the test verifies the behaviour of the store, not the encryption
 * of the operating system.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSettingsStore } from '../../apps/desktop/src/main/providers/settings';

/** The encrypted values of the mocked `safeStorage`. */
const encrypted = new Map<string, string>();
/** True when the operating system can encrypt. */
let encryptionAvailable = true;

/** The mocked Electron module. */
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (text: string) => {
      const cipher = `enc:${text}`;
      encrypted.set(cipher, text);
      return Buffer.from(cipher, 'utf8');
    },
    decryptString: (buffer: Buffer) => {
      const cipher = buffer.toString('utf8');
      const plain = encrypted.get(cipher);
      if (plain === undefined) {
        throw new Error('the value could not be decrypted');
      }
      return plain;
    },
  },
}));

const { CredentialStore } = await import(
  '../../apps/desktop/src/main/providers/credentials'
);

/** A settings store that keeps everything in memory. */
function fakeSettings(): ProviderSettingsStore & {
  values: Map<string, { id: string; encryptedKey: string | null }>;
} {
  const values = new Map<string, { id: string; encryptedKey: string | null }>();
  return {
    values,
    get: async (id: string) => {
      const value = values.get(id);
      return (value ?? null) as never;
    },
    set: async (settings: { id: string; encryptedKey: string | null }) => {
      values.set(settings.id, settings);
    },
    remove: async (id: string) => {
      values.delete(id);
    },
    load: async () => new Map(),
  } as unknown as ProviderSettingsStore & {
    values: Map<string, { id: string; encryptedKey: string | null }>;
  };
}

describe('credential store', () => {
  let store: InstanceType<typeof CredentialStore>;
  let settings: ReturnType<typeof fakeSettings>;

  beforeEach(() => {
    encrypted.clear();
    encryptionAvailable = true;
    settings = fakeSettings();
    store = new CredentialStore(settings);
  });

  it('encrypts the key before it is stored', async () => {
    const result = await store.setKey('openai-compatible', 'sk-secret-value');
    expect(result.ok).toBe(true);
    const stored = settings.values.get('openai-compatible') as {
      encryptedKey: string;
    };
    // The plaintext is not in the file.
    expect(stored.encryptedKey).not.toContain('sk-secret-value');
    expect(stored.encryptedKey.length).toBeGreaterThan(0);
  });

  it('reads the key back for the main process', async () => {
    await store.setKey('openai-compatible', 'sk-secret-value');
    expect(await store.getKey('openai-compatible')).toBe('sk-secret-value');
  });

  it('has no key when none was stored', async () => {
    expect(await store.getKey('openai-compatible')).toBeNull();
  });

  it('removes the key', async () => {
    await store.setKey('openai-compatible', 'sk-secret-value');
    const result = await store.clearKey('openai-compatible');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.configured).toBe(false);
    }
    expect(await store.getKey('openai-compatible')).toBeNull();
  });

  it('refuses an empty key', async () => {
    const result = await store.setKey('openai-compatible', '   ');
    expect(result.ok).toBe(false);
  });

  it('refuses to store the key when the system cannot encrypt', async () => {
    encryptionAvailable = false;
    const result = await store.setKey('openai-compatible', 'sk-secret-value');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('encrypt');
    }
    expect(settings.values.has('openai-compatible')).toBe(false);
  });

  it('never returns the key to the caller', async () => {
    const result = await store.setKey('openai-compatible', 'sk-secret-value');
    expect(JSON.stringify(result)).not.toContain('sk-secret-value');
  });
});
