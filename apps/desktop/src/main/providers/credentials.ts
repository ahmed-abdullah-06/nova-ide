/**
 * The storage of the API keys (spec §11.4, §19.5).
 *
 * A key is encrypted with the operating system (Electron's `safeStorage`)
 * before it is written to disk. Only the main process can decrypt it:
 * the renderer never receives a key, it only learns whether a key is
 * configured.
 *
 * If the operating system cannot encrypt (for example a Linux system
 * without a keyring), the key is *not* stored at all — a plaintext key
 * on the disk is worse than no key at all.
 */
import { safeStorage } from 'electron';
import type { AiResult } from '../../shared/ai-types';
import type { ProviderSettingsStore } from './settings';

export class CredentialStore {
  private readonly settings: ProviderSettingsStore;

  constructor(settings: ProviderSettingsStore) {
    this.settings = settings;
  }

  /**
   * Stores the API key of a provider.
   *
   * The key is encrypted before it is written and it is never returned.
   */
  async setKey(
    providerId: string,
    key: string,
  ): Promise<AiResult<{ configured: boolean }>> {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'The API key is empty.',
        },
      };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        error: {
          code: 'unauthorized',
          message:
            'This system cannot encrypt the API key safely, ' +
            'so it is not stored.',
        },
      };
    }
    try {
      const encrypted = safeStorage.encryptString(trimmed).toString('base64');
      const settings = await this.settings.get(providerId);
      await this.settings.set({
        ...(settings ?? {
          id: providerId,
          enabled: false,
          baseUrl: '',
          encryptedKey: null,
          remoteConfirmed: false,
        }),
        encryptedKey: encrypted,
      });
      return { ok: true, value: { configured: true } };
    } catch (error) {
      // The message of the error never contains the key.
      console.error(
        '[providers] the API key could not be stored:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The API key could not be stored.',
        },
      };
    }
  }

  /** Removes the API key of a provider. */
  async clearKey(
    providerId: string,
  ): Promise<AiResult<{ configured: boolean }>> {
    const settings = await this.settings.get(providerId);
    if (settings === null) {
      return { ok: true, value: { configured: false } };
    }
    await this.settings.set({ ...settings, encryptedKey: null });
    return { ok: true, value: { configured: false } };
  }

  /**
   * The decrypted key of a provider.
   *
   * This is the only place a key is read; the result never leaves the
   * main process.
   */
  async getKey(providerId: string): Promise<string | null> {
    const settings = await this.settings.get(providerId);
    if (settings === null || settings.encryptedKey === null) {
      return null;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return safeStorage.decryptString(
        Buffer.from(settings.encryptedKey, 'base64'),
      );
    } catch (error) {
      console.error(
        '[providers] the API key could not be decrypted:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return null;
    }
  }
}
