import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
  createNoOpMessagingGateway,
  createNoOpFinanceAdapter,
} from './noops/index.mjs';

/**
 * Config-driven adapter loading with lazy imports.
 * Loads adapters for a household based on their integrations config.
 *
 * Config sources:
 * - Capability/provider selection: household/integrations.yml
 * - Auth credentials: household/auth/{provider}.yml
 * - Service host/port: system/services.yml (resolved via ConfigService)
 */
export class IntegrationLoader {
  #registry;
  #configService;
  #loadedAdapters = new Map();
  #logger;

  /**
   * @param {Object} options
   * @param {AdapterRegistry} options.registry - Discovered adapter registry
   * @param {ConfigService} options.configService - For service URL resolution
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ registry, configService, logger = console }) {
    this.#registry = registry;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Load integrations for a household based on their config.
   *
   * @param {string} householdId - Household identifier
   * @param {object} deps - Shared dependencies (httpClient, etc.)
   * @returns {object} Adapters keyed by capability
   */
  async loadForHousehold(householdId, deps = {}) {
    const adapters = {};

    for (const capability of this.#registry.getAllCapabilities()) {
      const integrations = this.#configService.getCapabilityIntegrations(householdId, capability);

      // null, empty, or missing = use NoOp adapter
      if (!integrations || integrations.length === 0) {
        adapters[capability] = this.#createNoOp(capability);
        this.#logger.debug?.('integration.noop', { householdId, capability });
        continue;
      }

      // Load all configured providers for this capability
      adapters[capability] = await this.#loadMultiple(
        householdId, capability, integrations, deps
      );
    }

    this.#loadedAdapters.set(householdId, adapters);
    return adapters;
  }

  async #loadMultiple(householdId, capability, integrations, deps) {
    const adapters = [];

    for (const integration of integrations) {
      const provider = integration.provider;

      // Get manifest from discovered registry
      const manifest = this.#registry.getManifest(capability, provider);
      if (!manifest) {
        this.#logger.warn?.('integration.provider-not-discovered', { capability, provider });
        continue;
      }

      // Build complete config from three sources:
      // 1. Integration config (protocol, platform, etc.)
      // 2. Auth credentials (token, api_key, etc.)
      // 3. Service URL (resolved from services.yml)
      const config = this.#buildAdapterConfig(householdId, provider, integration);

      try {
        // Dynamic import from manifest
        const { default: AdapterClass } = await manifest.adapter();

        adapters.push({
          provider,
          adapter: new AdapterClass(config, deps),
        });

        this.#logger.info?.('integration.loaded', { householdId, capability, provider });
      } catch (err) {
        this.#logger.error?.('integration.load-failed', {
          capability, provider, error: err.message
        });
      }
    }

    if (adapters.length === 0) {
      return this.#createNoOp(capability);
    }

    // Return single adapter or wrap in MultiProviderAdapter
    return adapters.length === 1
      ? adapters[0].adapter
      : new MultiProviderAdapter(capability, adapters);
  }

  /**
   * Build complete adapter config from multiple sources.
   */
  #buildAdapterConfig(householdId, provider, integrationConfig) {
    // Get auth credentials (token, api_key, etc.)
    const auth = this.#configService.getHouseholdAuth(provider, householdId) ?? {};

    // Get service URL from services.yml
    const host = this.#configService.resolveServiceUrl(provider);

    return {
      // Integration-specific config (protocol, platform, etc.)
      ...integrationConfig,
      // Auth credentials
      ...auth,
      // Resolved service host (if available)
      ...(host ? { host } : {}),
    };
  }

  #createNoOp(capability) {
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] ?? {};
  }

  /**
   * Get loaded adapters for a household.
   */
  getAdapters(householdId) {
    return this.#loadedAdapters.get(householdId);
  }

  /**
   * Check if a capability is configured for a household.
   */
  hasCapability(householdId, capability) {
    const adapters = this.#loadedAdapters.get(householdId);
    const adapter = adapters?.[capability];
    if (!adapter) return false;

    // Check various availability methods (different adapters use different names)
    if (typeof adapter.isConfigured === 'function') return adapter.isConfigured();
    if (typeof adapter.isAvailable === 'function') return adapter.isAvailable();
    if (typeof adapter.isConnected === 'function') return adapter.isConnected();

    // If no check method, assume configured if adapter exists and is not empty object
    return Object.keys(adapter).length > 0;
  }
}

/**
 * Wrapper for multiple providers of the same capability.
 * Routes requests to appropriate provider based on key prefix.
 */
class MultiProviderAdapter {
  #capability;
  #adapters;  // Array of { provider, adapter }

  constructor(capability, adapters) {
    this.#capability = capability;
    this.#adapters = adapters;
  }

  /**
   * Get adapter for a specific provider.
   */
  getProvider(provider) {
    return this.#adapters.find(a => a.provider === provider)?.adapter;
  }

  /**
   * Get all adapters.
   */
  getAllProviders() {
    return this.#adapters;
  }

  /**
   * Get the primary (first) adapter.
   */
  getPrimary() {
    return this.#adapters[0]?.adapter;
  }

  isAvailable() {
    return this.#adapters.length > 0;
  }

  isConfigured() {
    return this.#adapters.length > 0;
  }
}
