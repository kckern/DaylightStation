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
 */
export class IntegrationLoader {
  #registry;
  #loadedAdapters = new Map();
  #logger;

  constructor({ registry, logger = console }) {
    this.#registry = registry;
    this.#logger = logger;
  }

  /**
   * Load integrations for a household based on their config.
   *
   * @param {string} householdId - Household identifier
   * @param {object} householdConfig - Household integrations config (capability -> provider[])
   * @param {object} authConfig - Auth credentials keyed by provider
   * @param {object} deps - Shared dependencies (httpClient, logger, etc.)
   * @returns {object} Adapters keyed by capability
   */
  async loadForHousehold(householdId, householdConfig, authConfig, deps) {
    const adapters = {};

    for (const capability of this.#registry.getAllCapabilities()) {
      const configs = householdConfig[capability];

      // null, empty, or missing = use NoOp adapter
      if (!configs || configs.length === 0) {
        adapters[capability] = this.#createNoOp(capability);
        continue;
      }

      // Load all configured providers for this capability
      adapters[capability] = await this.#loadMultiple(
        capability, configs, authConfig, deps
      );
    }

    this.#loadedAdapters.set(householdId, adapters);
    return adapters;
  }

  async #loadMultiple(capability, configs, auth, deps) {
    const adapters = [];

    for (const config of configs) {
      const provider = config.provider;

      // Get manifest from discovered registry
      const manifest = this.#registry.getManifest(capability, provider);
      if (!manifest) {
        this.#logger.warn?.('provider-not-discovered', { capability, provider });
        continue;
      }

      // Dynamic import from manifest
      const { default: AdapterClass } = await manifest.adapter();

      // Merge config with secrets from auth files
      const mergedConfig = {
        ...config,
        ...(auth[provider] || {}),
      };

      adapters.push({
        provider,
        adapter: new AdapterClass(mergedConfig, deps),
      });
    }

    if (adapters.length === 0) {
      return this.#createNoOp(capability);
    }

    // Return single adapter or wrap in MultiProviderAdapter
    return adapters.length === 1
      ? adapters[0].adapter
      : new MultiProviderAdapter(capability, adapters);
  }

  #createNoOp(capability) {
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] || {};
  }

  /**
   * Get loaded adapters for a household.
   */
  getAdapters(householdId) {
    return this.#loadedAdapters.get(householdId);
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
