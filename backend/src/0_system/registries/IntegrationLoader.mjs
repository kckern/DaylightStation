import { HouseholdAdapters } from './HouseholdAdapters.mjs';
import {
  parseIntegrationsConfig,
  PROVIDER_CAPABILITY_MAP,
} from './integrationConfigParser.mjs';

/**
 * Config-driven adapter loading with lazy imports.
 * Loads adapters for a household based on their integrations config.
 *
 * Config sources:
 * - Service entries: integrations.yml (plex, homeassistant, etc.)
 * - App routing: integrations.yml (ai.nutribot, messaging.homebot, etc.)
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
   * @returns {HouseholdAdapters} Adapters wrapper with per-app routing
   */
  async loadForHousehold(householdId, deps = {}) {
    const rawConfig = this.#configService.getIntegrationsConfig?.(householdId) ?? {};
    const { services, appRouting, unknownKeys } = parseIntegrationsConfig(rawConfig);

    for (const key of unknownKeys) {
      this.#logger.warn?.('integration.unknown-key', { householdId, key });
    }

    const adapters = {};
    const defaults = {};

    // Load adapters from service entries (plex, homeassistant, etc.)
    for (const [provider, serviceConfig] of Object.entries(services)) {
      const capability = PROVIDER_CAPABILITY_MAP[provider];
      if (!capability) continue;

      const adapter = await this.#loadAdapter(householdId, capability, provider, serviceConfig, deps);
      if (adapter) {
        if (!adapters[capability]) adapters[capability] = {};
        adapters[capability][provider] = adapter;
        if (!defaults[capability]) defaults[capability] = provider;
      }
    }

    // Load adapters from app routing (ai.nutribot → openai)
    for (const [capability, appProviders] of Object.entries(appRouting)) {
      const uniqueProviders = [...new Set(Object.values(appProviders))];
      for (const provider of uniqueProviders) {
        if (adapters[capability]?.[provider]) continue;
        const adapter = await this.#loadAdapter(householdId, capability, provider, {}, deps);
        if (adapter) {
          if (!adapters[capability]) adapters[capability] = {};
          adapters[capability][provider] = adapter;
          if (!defaults[capability]) defaults[capability] = provider;
        }
      }
    }

    const householdAdapters = new HouseholdAdapters({ adapters, appRouting, defaults });
    this.#loadedAdapters.set(householdId, householdAdapters);

    this.#logger.info?.('integrations.loaded', {
      householdId,
      services: Object.keys(services),
      capabilities: Object.keys(adapters),
    });

    return householdAdapters;
  }

  async #loadAdapter(householdId, capability, provider, serviceConfig, deps) {
    const manifest = this.#registry.getManifest(capability, provider);
    if (!manifest) {
      this.#logger.warn?.('integration.provider-not-discovered', { capability, provider });
      return null;
    }

    const config = this.#buildAdapterConfig(householdId, provider, serviceConfig);

    try {
      const { default: AdapterClass } = await manifest.adapter();
      return new AdapterClass(config, deps);
    } catch (err) {
      this.#logger.error?.('integration.adapter.failed', { capability, provider, error: err.message });
      return null;
    }
  }

  /**
   * Build complete adapter config from multiple sources.
   *
   * Sources (in priority order, later overrides earlier):
   * 1. Service config from integrations.yml (port, protocol, etc.)
   * 2. Auth credentials from household/auth/{provider}.yml
   * 3. Secrets from secrets.yml (e.g., OPENAI_API_KEY)
   * 4. Service URL from services.yml
   */
  #buildAdapterConfig(householdId, provider, serviceConfig) {
    const auth = this.#configService.getHouseholdAuth?.(provider, householdId) ?? {};
    const serviceUrl = this.#configService.resolveServiceUrl?.(provider);
    const secrets = this.#getProviderSecrets(provider);

    return this.#normalizeConfig(provider, {
      ...serviceConfig,
      ...auth,
      ...secrets,
      ...(serviceUrl ? { host: serviceUrl } : {}),
    });
  }

  /**
   * Get secrets for a provider from secrets.yml
   * Maps provider-specific secret keys to adapter-expected field names
   */
  #getProviderSecrets(provider) {
    const secretKeyMap = {
      openai: { OPENAI_API_KEY: 'apiKey' },
      anthropic: { ANTHROPIC_API_KEY: 'apiKey' },
      telegram: { TELEGRAM_BOT_TOKEN: 'token' },
    };
    const mappings = secretKeyMap[provider] || {};
    const secrets = {};
    for (const [envKey, configKey] of Object.entries(mappings)) {
      const value = this.#configService.getSecret?.(envKey);
      if (value) secrets[configKey] = value;
    }
    return secrets;
  }

  /**
   * Normalize config field names for adapter compatibility.
   * Adapters expect specific field names (e.g., apiKey, baseUrl)
   * but config files use different conventions (e.g., api_key, host).
   */
  #normalizeConfig(provider, config) {
    const normalized = { ...config };
    const fieldMappings = {
      api_key: 'apiKey',
      base_url: 'baseUrl',
      access_token: 'accessToken',
    };
    for (const [snake, camel] of Object.entries(fieldMappings)) {
      if (normalized[snake] !== undefined && normalized[camel] === undefined) {
        normalized[camel] = normalized[snake];
        delete normalized[snake];
      }
    }
    if (provider === 'homeassistant' && normalized.host && !normalized.baseUrl) {
      normalized.baseUrl = normalized.host;
      delete normalized.host;
    }
    return normalized;
  }

  /**
   * Get loaded adapters for a household.
   */
  getAdapters(householdId) {
    return this.#loadedAdapters.get(householdId);
  }

  /**
   * Check if a capability is configured for a household.
   * @param {string} householdId - Household identifier
   * @param {string} capability - Capability name
   * @param {string} [appName] - Optional app name for per-app routing
   */
  hasCapability(householdId, capability, appName = null) {
    return this.#loadedAdapters.get(householdId)?.has(capability, appName) ?? false;
  }
}

export default IntegrationLoader;
