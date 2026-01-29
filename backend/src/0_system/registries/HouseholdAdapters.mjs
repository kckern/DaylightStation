import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
  createNoOpMessagingGateway,
  createNoOpFinanceAdapter,
} from './noops/index.mjs';

/**
 * Wrapper for household adapters with per-app routing support.
 *
 * @example
 * const adapters = new HouseholdAdapters({ adapters, appRouting, defaults });
 * adapters.get('ai', 'nutribot');  // → OpenAI adapter
 * adapters.get('media');           // → Plex adapter (default)
 */
export class HouseholdAdapters {
  #adapters;    // capability → provider → adapter
  #appRouting;  // capability → app → provider
  #defaults;    // capability → default provider

  constructor({ adapters, appRouting, defaults }) {
    this.#adapters = adapters;
    this.#appRouting = appRouting;
    this.#defaults = defaults;
  }

  /**
   * Get adapter for a capability, optionally scoped to an app.
   *
   * @param {string} capability - Capability name (ai, media, etc.)
   * @param {string} [appName] - App name for per-app routing (nutribot, journalist, etc.)
   * @returns {object} Adapter instance or NoOp adapter
   */
  get(capability, appName = null) {
    const capAdapters = this.#adapters[capability];
    if (!capAdapters || Object.keys(capAdapters).length === 0) {
      return this.#createNoOp(capability);
    }

    // Determine which provider to use
    let provider;
    if (appName && this.#appRouting[capability]?.[appName]) {
      // App-specific routing
      provider = this.#appRouting[capability][appName];
    } else {
      // Default provider for capability
      provider = this.#defaults[capability];
    }

    return capAdapters[provider] ?? this.#createNoOp(capability);
  }

  /**
   * Check if capability is configured (not NoOp).
   */
  has(capability, appName = null) {
    const adapter = this.get(capability, appName);
    if (!adapter) return false;
    if (typeof adapter.isConfigured === 'function') return adapter.isConfigured();
    if (typeof adapter.isAvailable === 'function') return adapter.isAvailable();
    return Object.keys(adapter).length > 0;
  }

  /**
   * List all configured providers for a capability.
   */
  providers(capability) {
    return Object.keys(this.#adapters[capability] ?? {});
  }

  #createNoOp(capability) {
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] ?? { isConfigured: () => false };
  }
}
