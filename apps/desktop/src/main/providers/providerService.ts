/**
 * The provider service (spec §10.3, §11).
 *
 * It ties the registry, the settings and the adapters together:
 *  - the providers the application offers,
 *  - their settings (address, enabled, key),
 *  - the models they offer and their connection state.
 *
 * The service is the only place that knows the concrete adapters, so a
 * new provider can be added without touching the user interface.
 */
import type {
  AiResult,
  ProviderDescriptor,
  ProviderModel,
  ProviderStatus,
} from '../../shared/ai-types';
import type { AIProvider } from './interfaces/provider';
import { OllamaProvider } from './ollama/ollamaProvider';
import { OpenAiCompatibleProvider } from './openai/openaiCompatibleProvider';
import { ProviderRegistry } from './registry';
import {
  isLoopbackUrl,
  normalizeBaseUrl,
  validateProviderUrl,
} from './urlPolicy';
import {
  defaultProviderSettings,
  ProviderSettingsStore,
  type ProviderSettings,
} from './settings';

/** The providers the application offers out of the box. */
const BUILT_IN_PROVIDERS = ['ollama', 'openai-compatible'] as const;

export class ProviderService {
  private readonly registry = new ProviderRegistry();
  private readonly settings: ProviderSettingsStore;
  /** Reads the API key of a provider (the main process only). */
  private readonly getApiKey: (providerId: string) => Promise<string | null>;

  constructor(
    settings: ProviderSettingsStore,
    getApiKey: (providerId: string) => Promise<string | null> = async () => null,
  ) {
    this.settings = settings;
    this.getApiKey = getApiKey;
  }

  /**
   * Creates the providers from the current settings.
   *
   * It is called at startup and whenever a setting changes, so a changed
   * address takes effect immediately.
   */
  async sync(): Promise<void> {
    for (const id of BUILT_IN_PROVIDERS) {
      const settings = await this.settings.get(id);
      const provider = await this.createProvider(
        id,
        settings ?? defaultProviderSettings(id),
      );
      if (provider !== null) {
        this.registry.register(provider);
      }
    }
  }

  /**
   * The providers as the renderer sees them.
   *
   * The descriptors never contain a key — the renderer only learns
   * whether one is configured (spec §19.5).
   */
  async descriptors(): Promise<AiResult<ProviderDescriptor[]>> {
    await this.sync();
    const descriptors: ProviderDescriptor[] = [];
    for (const provider of this.registry.list()) {
      const settings =
        (await this.settings.get(provider.id)) ??
        defaultProviderSettings(provider.id);
      descriptors.push({
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        enabled: settings.enabled,
        baseUrl: settings.baseUrl,
        hasKey: settings.encryptedKey !== null,
        remoteConfirmed: settings.remoteConfirmed,
      });
    }
    return { ok: true, value: descriptors };
  }

  /** The models a provider offers. */
  async models(providerId: string): Promise<AiResult<ProviderModel[]>> {
    const provider = await this.resolve(providerId);
    if (provider === null) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }
    return provider.listModels();
  }

  /** Checks whether a provider can be reached. */
  async status(providerId: string): Promise<AiResult<ProviderStatus>> {
    const provider = await this.resolve(providerId);
    if (provider === null) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }
    return { ok: true, value: await provider.checkConnection() };
  }

  /** The provider with the given id (null when it is unknown). */
  async resolve(providerId: string): Promise<AIProvider | null> {
    await this.sync();
    return this.registry.get(providerId) ?? null;
  }

  /** The settings of one provider. */
  async settingsOf(providerId: string): Promise<ProviderSettings> {
    const settings = await this.settings.get(providerId);
    return settings ?? defaultProviderSettings(providerId);
  }

  /**
   * Changes the settings of a provider.
   *
   * The address of a cloud provider must be confirmed by the user before
   * it is used — otherwise a setting could silently point the requests
   * of the user at an unknown service.
   */
  async update(
    providerId: string,
    changes: {
      baseUrl?: string;
      enabled?: boolean;
      remoteConfirmed?: boolean;
    },
  ): Promise<AiResult<ProviderDescriptor>> {
    if (!this.registry.has(providerId)) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }
    const current = await this.settingsOf(providerId);

    let baseUrl = current.baseUrl;
    if (changes.baseUrl !== undefined) {
      const problem = validateProviderUrl(changes.baseUrl);
      if (problem !== null) {
        return { ok: false, error: { code: 'unknown', message: problem } };
      }
      baseUrl = normalizeBaseUrl(changes.baseUrl);
    }

    const remoteConfirmed =
      changes.remoteConfirmed ?? current.remoteConfirmed ?? false;
    if (!isLoopbackUrl(baseUrl) && !remoteConfirmed) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message:
            'This address is not on this machine. ' +
            'Confirm it before it can be used.',
        },
      };
    }

    await this.settings.set({
      ...current,
      baseUrl,
      enabled: changes.enabled ?? current.enabled,
      remoteConfirmed,
    });
    await this.sync();
    const descriptors = await this.descriptors();
    if (!descriptors.ok) {
      return descriptors;
    }
    const descriptor = descriptors.value.find(
      (entry) => entry.id === providerId,
    );
    if (descriptor === undefined) {
      return {
        ok: false,
        error: { code: 'unknown', message: 'The provider is not available.' },
      };
    }
    return { ok: true, value: descriptor };
  }

  /** Removes the configuration of a provider (it returns to the default). */
  async remove(providerId: string): Promise<AiResult<ProviderDescriptor>> {
    if (!this.registry.has(providerId)) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }
    await this.settings.remove(providerId);
    await this.sync();
    const descriptors = await this.descriptors();
    if (!descriptors.ok) {
      return descriptors;
    }
    const descriptor = descriptors.value.find(
      (entry) => entry.id === providerId,
    );
    if (descriptor === undefined) {
      return {
        ok: false,
        error: { code: 'unknown', message: 'The provider is not available.' },
      };
    }
    return { ok: true, value: descriptor };
  }

  /** Creates the adapter of a provider (null for an unknown id). */
  private async createProvider(
    id: string,
    settings: ProviderSettings,
  ): Promise<AIProvider | null> {
    switch (id) {
      case 'ollama':
        return new OllamaProvider({
          baseUrl: settings.baseUrl,
          remoteConfirmed: settings.remoteConfirmed,
        });
      case 'openai-compatible':
        return new OpenAiCompatibleProvider({
          baseUrl: settings.baseUrl,
          // The key comes from the credential store; it is decrypted for
          // this request only and never leaves the main process.
          apiKey: await this.getApiKey(id),
        });
      default:
        return null;
    }
  }
}
