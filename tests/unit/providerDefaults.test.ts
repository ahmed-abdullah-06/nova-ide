/**
 * Tests for the default settings of the providers (spec §11.3).
 *
 * On a fresh profile the local provider must point at the default
 * address of Ollama — the test never contacted a real service.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The directory the store writes into. */
let userData = '';

/** The mocked Electron module. */
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}));

const { ProviderSettingsStore } = await import(
  '../../apps/desktop/src/main/providers/settings'
);
const { DEFAULT_OLLAMA_URL } = await import(
  '../../apps/desktop/src/main/providers/urlPolicy'
);
const { ProviderService } = await import(
  '../../apps/desktop/src/main/providers/providerService'
);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nova-defaults-'));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('the default settings of the providers', () => {
  it('points the local provider at the default address of Ollama', () => {
    expect(DEFAULT_OLLAMA_URL).toBe('http://127.0.0.1:11434');
  });

  it('offers the local provider on a fresh profile', async () => {
    const service = new ProviderService(new ProviderSettingsStore());
    const result = await service.descriptors();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ollama = result.value.find((entry) => entry.id === 'ollama');
      expect(ollama?.baseUrl).toBe('http://127.0.0.1:11434');
      expect(ollama?.kind).toBe('local');
      expect(ollama?.enabled).toBe(true);
      expect(ollama?.hasKey).toBe(false);
      expect(ollama?.remoteConfirmed).toBe(false);
    }
  });

  it('keeps the cloud provider disabled on a fresh profile', async () => {
    const service = new ProviderService(new ProviderSettingsStore());
    const result = await service.descriptors();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cloud = result.value.find(
        (entry) => entry.id === 'openai-compatible',
      );
      expect(cloud?.enabled).toBe(false);
      expect(cloud?.hasKey).toBe(false);
    }
  });

  it('keeps the address of a profile that was written before', async () => {
    await writeFile(
      path.join(userData, 'providers.json'),
      JSON.stringify({
        version: 1,
        providers: [
          {
            id: 'ollama',
            enabled: true,
            baseUrl: 'http://127.0.0.1:5555',
            encryptedKey: null,
            remoteConfirmed: false,
          },
        ],
      }),
      'utf8',
    );
    const service = new ProviderService(new ProviderSettingsStore());
    const result = await service.descriptors();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ollama = result.value.find((entry) => entry.id === 'ollama');
      expect(ollama?.baseUrl).toBe('http://127.0.0.1:5555');
    }
  });
});
