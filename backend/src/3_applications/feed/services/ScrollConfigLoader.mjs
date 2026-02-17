// backend/src/3_applications/feed/services/ScrollConfigLoader.mjs
/**
 * ScrollConfigLoader
 *
 * Reads per-user scroll config from DataService and deep-merges
 * with hardcoded defaults. If no user config file exists, defaults
 * are returned unchanged.
 *
 * Consumed by FeedAssemblyService / TierAssemblyService to control
 * tier allocations, selection strategies, spacing rules, and
 * per-source distribution caps.
 *
 * @module applications/feed/services
 */

const TIER_DEFAULTS = Object.freeze({
  wire: Object.freeze({
    selection: Object.freeze({ sort: 'timestamp_desc', filter: [], diversity: 'source' }),
    sources: Object.freeze({}),
  }),
  library: Object.freeze({
    allocation: 2,
    selection: Object.freeze({ sort: 'random', filter: [], freshness: false }),
    sources: Object.freeze({}),
  }),
  scrapbook: Object.freeze({
    allocation: 2,
    selection: Object.freeze({ sort: 'random', filter: [], prefer: 'anniversary' }),
    sources: Object.freeze({}),
  }),
  compass: Object.freeze({
    allocation: 6,
    selection: Object.freeze({ sort: 'priority', filter: [], freshness: true }),
    sources: Object.freeze({}),
  }),
});

const DEFAULTS = Object.freeze({
  batch_size: 15,
  spacing: Object.freeze({
    max_consecutive: 1,
  }),
  tiers: TIER_DEFAULTS,
});

export class ScrollConfigLoader {
  #dataService;

  constructor({ dataService }) {
    this.#dataService = dataService;
  }

  /**
   * Load scroll config for a user, merging overrides with defaults.
   *
   * @param {string} username
   * @returns {Object} Merged scroll config
   */
  load(username) {
    const feedConfig = this.#dataService.user.read('config/feed', username) || {};
    const scrollConfig = feedConfig.scroll || {};
    return this.#merge(scrollConfig);
  }

  /**
   * Get a flat map of all source keys across all tiers.
   * Used by FeedAssemblyService to filter query configs.
   *
   * @param {Object} scrollConfig - Merged scroll config
   * @returns {Set<string>} Set of enabled source keys
   */
  static getEnabledSources(scrollConfig) {
    const sources = new Set();
    const tiers = scrollConfig.tiers || {};
    for (const tier of Object.values(tiers)) {
      for (const key of Object.keys(tier.sources || {})) {
        sources.add(key);
      }
    }
    return sources;
  }

  /**
   * Build a flat color map from merged scroll config.
   * Source-level colors override tier-level colors.
   *
   * @param {Object} scrollConfig - Merged scroll config
   * @returns {Object<string, string>} { source: hexColor, tier: hexColor }
   */
  static extractColors(scrollConfig) {
    const colors = {};
    const tiers = scrollConfig.tiers || {};
    for (const [tierName, tier] of Object.entries(tiers)) {
      if (tier.color) colors[tierName] = tier.color;
      for (const [sourceKey, sourceCfg] of Object.entries(tier.sources || {})) {
        if (sourceCfg.color) colors[sourceKey] = sourceCfg.color;
      }
    }
    return colors;
  }

  #merge(user) {
    return {
      batch_size: user.batch_size ?? DEFAULTS.batch_size,
      spacing: {
        ...DEFAULTS.spacing,
        ...user.spacing,
      },
      tiers: this.#mergeTiers(user.tiers || {}),
    };
  }

  #mergeTiers(userTiers) {
    const result = {};
    for (const [tierName, defaults] of Object.entries(TIER_DEFAULTS)) {
      const user = userTiers[tierName] || {};
      result[tierName] = {
        allocation: user.allocation ?? defaults.allocation,
        ...(user.color ? { color: user.color } : {}),
        selection: {
          ...defaults.selection,
          ...user.selection,
        },
        sources: {
          ...(defaults.sources || {}),
          ...(user.sources || {}),
        },
      };
    }
    return result;
  }
}
