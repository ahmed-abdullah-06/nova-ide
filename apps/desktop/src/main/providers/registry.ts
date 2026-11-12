/**
 * The provider registry (spec §10.3, §11).
 *
 * The registry knows every provider the application offers. The user
 * picks a provider and a model; nothing is hard-coded to a single model
 * or a single service.
 */
import type { ProviderDescriptor } from '../../shared/ai-types';
import type { AIProvider } from './interfaces/provider';

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  /** Adds a provider (a later registration of the same id replaces it). */
  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** The provider with the given id (undefined when it is unknown). */
  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  /** Every registered provider. */
  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  /** True when a provider with the given id exists. */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * The providers as the renderer sees them.
   *
   * The descriptors never contain a key — the renderer only learns
   * whether a key is configured (spec §19.5).
   */
  describe(
    resolve: (provider: AIProvider) => {
      enabled: boolean;
      baseUrl: string;
      hasKey: boolean;
      remoteConfirmed: boolean;
    },
  ): ProviderDescriptor[] {
    return this.list().map((provider) => {
      const state = resolve(provider);
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        enabled: state.enabled,
        baseUrl: state.baseUrl,
        hasKey: state.hasKey,
        remoteConfirmed: state.remoteConfirmed,
      };
    });
  }
}
