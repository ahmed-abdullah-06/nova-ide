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
import { ProviderRegistry } from './registry';
import {
  defaultProviderSettings,
  ProviderSettingsStore,
  type ProviderSettings,
} from './settings';

/** The providers the application offers out of the box. */
const BUILT_IN_PROVIDERS = ['ollama'] as const;

export class ProviderService {
  private readonly registry = new ProviderRegistry();
  private readonly settings: ProviderSettingsStore;

  constructor(settings: ProviderSettingsStore) {
    this.settings = settings;
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
      const provider = this.createProvider(id, settings ?? defaultProviderSettings(id));
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

  /** Creates the adapter of a provider (null for an unknown id). */
  private createProvider(
    id: string,
    settings: ProviderSettings,
  ): AIProvider | null {
    switch (id) {
      case 'ollama':
        return new OllamaProvider({
          baseUrl: settings.baseUrl,
          remoteConfirmed: settings.remoteConfirmed,
        });
      default:
        return null;
    }
  }
}
