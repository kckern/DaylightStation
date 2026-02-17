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
  wire_decay_batches: 10,
  spacing: Object.freeze({
    max_consecutive: 1,
  }),
  tiers: TIER_DEFAULTS,
});

const DEFAULT_MAX_AGE_HOURS = Object.freeze({
  freshrss: 336,    // 2 weeks
  reddit: 168,      // 1 week
  headlines: 48,
  googlenews: 48,
});

const TIER_DEFAULT_MAX_AGE = Object.freeze({
  wire: 48,
  library: null,      // timeless
  scrapbook: null,    // timeless
  compass: 48,
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

  /**
   * Get source keys marked as padding sources.
   * Padding sources fill remaining batch slots when primary content is exhausted.
   *
   * @param {Object} scrollConfig - Merged scroll config
   * @returns {Set<string>} Set of source keys with padding: true
   */
  static getPaddingSources(scrollConfig) {
    const padding = new Set();
    const tiers = scrollConfig.tiers || {};
    for (const tier of Object.values(tiers)) {
      for (const [key, cfg] of Object.entries(tier.sources || {})) {
        if (cfg.padding) padding.add(key);
      }
    }
    return padding;
  }

  /**
   * Get max age in milliseconds for a source.
   * Returns null if the source has no age limit (timeless content).
   *
   * Priority: source-level config > hardcoded source default > tier-level default > 48h fallback
   *
   * @param {Object} scrollConfig - Merged scroll config
   * @param {string} sourceKey - Source identifier (e.g. 'reddit', 'freshrss')
   * @returns {number|null} Max age in ms, or null for unlimited
   */
  static getMaxAgeMs(scrollConfig, sourceKey) {
    // Check source-level override in any tier
    const tiers = scrollConfig.tiers || {};
    for (const [tierName, tier] of Object.entries(tiers)) {
      const sourceCfg = tier.sources?.[sourceKey];
      if (sourceCfg && 'max_age_hours' in sourceCfg) {
        return sourceCfg.max_age_hours === null ? null : sourceCfg.max_age_hours * 3600000;
      }
    }

    // Check hardcoded source defaults
    if (sourceKey in DEFAULT_MAX_AGE_HOURS) {
      return DEFAULT_MAX_AGE_HOURS[sourceKey] * 3600000;
    }

    // Check tier-level default (find which tier this source belongs to)
    for (const [tierName, tier] of Object.entries(tiers)) {
      if (tier.sources?.[sourceKey] !== undefined) {
        const tierDefault = TIER_DEFAULT_MAX_AGE[tierName];
        return tierDefault === null ? null : (tierDefault ?? 48) * 3600000;
      }
    }

    // Absolute fallback: 48 hours
    return 48 * 3600000;
  }

  #merge(user) {
    return {
      batch_size: user.batch_size ?? DEFAULTS.batch_size,
      wire_decay_batches: user.wire_decay_batches ?? DEFAULTS.wire_decay_batches,
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
