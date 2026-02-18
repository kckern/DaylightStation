// backend/src/3_applications/feed/services/TierAssemblyService.mjs
/**
 * TierAssemblyService
 *
 * Four-tier feed assembly: wire, library, scrapbook, compass.
 * Replaces the two-tier (external/grounding) interleaving model.
 *
 * Level 1 — Batch distribution: each tier gets a fixed allocation.
 * Level 2 — Within-tier selection: filter → sort → pick per tier strategy.
 *
 * Wire fills remaining slots after other tiers are allocated.
 * Non-wire items are interleaved into the wire backbone with spacing.
 *
 * @module applications/feed/services
 */

/** Canonical tier identifiers */
export const TIERS = Object.freeze({
  WIRE: 'wire',
  LIBRARY: 'library',
  SCRAPBOOK: 'scrapbook',
  COMPASS: 'compass',
});

/** Default tier config (used when scroll config omits a tier) */
const TIER_DEFAULTS = Object.freeze({
  wire: {
    selection: { sort: 'timestamp_desc', filter: [], diversity: 'source' },
  },
  library: {
    allocation: 2,
    selection: { sort: 'random', filter: [], freshness: false },
  },
  scrapbook: {
    allocation: 2,
    selection: { sort: 'random', filter: [], prefer: 'anniversary' },
  },
  compass: {
    allocation: 6,
    selection: { sort: 'priority', filter: [], freshness: true },
  },
});

export class TierAssemblyService {
  #spacingEnforcer;
  #logger;

  constructor({ spacingEnforcer = null, logger = console } = {}) {
    this.#spacingEnforcer = spacingEnforcer;
    this.#logger = logger;
  }

  /**
   * Assemble a batch from pre-fetched items using tier-based distribution.
   *
   * @param {Object[]} allItems - All fetched items (with `tier` field set by adapter/query)
   * @param {Object} scrollConfig - Merged scroll config (from ScrollConfigLoader)
   * @param {Object} options
   * @param {number} options.effectiveLimit - Max items to return
   * @param {string} [options.focus] - Focus source key (wire-only filtering)
   * @returns {{ items: Object[], hasMore: boolean }}
   */
  assemble(allItems, scrollConfig, { effectiveLimit, focus, selectionCounts, batchNumber = 1 } = {}) {
    const tierConfig = this.#resolveTierConfig(scrollConfig);
    const wireDecayBatches = scrollConfig.wire_decay_batches ?? 10;

    // Apply wire decay: adjust allocations based on batch number
    const decayedConfig = this.#applyWireDecay(tierConfig, effectiveLimit, batchNumber, wireDecayBatches);

    // Bucket items by tier
    const buckets = this.#bucketByTier(allItems);

    // Level 2: within-tier selection
    const selected = {};
    for (const tier of Object.values(TIERS)) {
      const candidates = buckets[tier] || [];
      const config = decayedConfig[tier] || TIER_DEFAULTS[tier];
      selected[tier] = this.#selectForTier(tier, candidates, config, { focus, selectionCounts });
    }

    // Level 1: allocate slots and interleave
    const interleaved = this.#interleave(selected, decayedConfig, effectiveLimit);

    // Deduplicate
    const seen = new Set();
    const deduplicated = interleaved.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Spacing enforcement
    const spaced = this.#spacingEnforcer?.enforce(deduplicated, scrollConfig)
      ?? deduplicated;

    const items = spaced.slice(0, effectiveLimit);

    this.#logger.info?.('tier.assembly.batch', {
      total: allItems.length,
      batchNumber,
      wireDecayFactor: Math.max(0, Math.min(1, 1 - (batchNumber - 1) / wireDecayBatches)).toFixed(2),
      wire: selected.wire?.length || 0,
      library: selected.library?.length || 0,
      scrapbook: selected.scrapbook?.length || 0,
      compass: selected.compass?.length || 0,
      returned: items.length,
    });

    return {
      items,
      hasMore: spaced.length > effectiveLimit,
    };
  }

  // ======================================================================
  // Tier Configuration
  // ======================================================================

  /**
   * Merge user scroll config tiers with defaults.
   * @param {Object} scrollConfig
   * @returns {Object} Resolved tier config keyed by tier name
   */
  #resolveTierConfig(scrollConfig) {
    const userTiers = scrollConfig.tiers || {};
    const resolved = {};

    for (const tier of Object.values(TIERS)) {
      const defaults = TIER_DEFAULTS[tier] || {};
      const user = userTiers[tier] || {};

      resolved[tier] = {
        allocation: user.allocation ?? defaults.allocation,
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

    return resolved;
  }

  // ======================================================================
  // Wire Decay
  // ======================================================================

  /**
   * Compute decayed tier allocations based on batch number.
   * Wire allocation decays linearly from its base value to 0 over wireDecayBatches.
   * Freed slots are distributed proportionally to non-wire tiers.
   *
   * @param {Object} tierConfig - Resolved tier config
   * @param {number} batchSize - Target batch size
   * @param {number} batchNumber - Current batch (1-indexed)
   * @param {number} wireDecayBatches - Batches until wire reaches 0
   * @returns {Object} New tier config with adjusted allocations
   */
  #applyWireDecay(tierConfig, batchSize, batchNumber, wireDecayBatches) {
    if (wireDecayBatches <= 0 || batchNumber <= 1) return tierConfig;

    // Compute base wire slots (batch_size minus all non-wire allocations)
    const compassAlloc = tierConfig.compass?.allocation ?? TIER_DEFAULTS.compass.allocation;
    const libraryAlloc = tierConfig.library?.allocation ?? TIER_DEFAULTS.library.allocation;
    const scrapbookAlloc = tierConfig.scrapbook?.allocation ?? TIER_DEFAULTS.scrapbook.allocation;
    const totalNonWire = compassAlloc + libraryAlloc + scrapbookAlloc;
    const baseWire = Math.max(0, batchSize - totalNonWire);

    if (baseWire === 0) return tierConfig;

    // Linear decay: batch 1 = full wire, batch wireDecayBatches+1 = 0 wire
    const decayFactor = Math.max(0, Math.min(1, 1 - (batchNumber - 1) / wireDecayBatches));
    const decayedWire = Math.round(baseWire * decayFactor);
    const freed = baseWire - decayedWire;

    if (freed === 0) return tierConfig;

    // Distribute freed slots proportionally to non-wire tiers
    const compassShare = Math.round(freed * compassAlloc / totalNonWire);
    const libraryShare = Math.round(freed * libraryAlloc / totalNonWire);
    // Scrapbook gets the remainder to avoid rounding drift
    const scrapbookShare = freed - compassShare - libraryShare;

    return {
      ...tierConfig,
      wire: {
        ...tierConfig.wire,
        allocation: decayedWire,
      },
      compass: {
        ...tierConfig.compass,
        allocation: compassAlloc + compassShare,
      },
      library: {
        ...tierConfig.library,
        allocation: libraryAlloc + libraryShare,
      },
      scrapbook: {
        ...tierConfig.scrapbook,
        allocation: scrapbookAlloc + scrapbookShare,
      },
    };
  }

  // ======================================================================
  // Level 2: Within-Tier Selection
  // ======================================================================

  /**
   * Select items for a single tier based on its strategy.
   *
   * @param {string} tier - Tier name
   * @param {Object[]} candidates - All items in this tier
   * @param {Object} config - Tier config (allocation, selection, sources)
   * @param {Object} options
   * @returns {Object[]} Selected items for this tier
   */
  #selectForTier(tier, candidates, config, { focus, selectionCounts } = {}) {
    if (!candidates.length) return [];

    let items = [...candidates];

    // Focus mode: filter wire to focused source only
    if (tier === TIERS.WIRE && focus) {
      items = this.#applyFocusFilter(items, focus);
    }

    // Apply tier selection strategy
    items = this.#applyTierFilters(items, config.selection);
    items = this.#applyTierSort(items, config.selection, selectionCounts);

    // Partition into primary and filler sources, select primary first
    const fillerSources = this.#getFillerSources(config.sources);
    if (fillerSources.size > 0) {
      const primary = items.filter(i => !fillerSources.has(i.source));
      const filler = items.filter(i => fillerSources.has(i.source));
      const cappedPrimary = this.#applySourceCaps(primary, config.sources);
      // Guarantee filler minimum before primary takes all slots
      const fillerMin = this.#getFillerMin(config.sources, fillerSources);
      const cappedFiller = this.#applySourceCaps(filler, config.sources);
      const guaranteedFiller = cappedFiller.slice(0, Math.max(fillerMin, 0));
      const remainingFiller = cappedFiller.slice(fillerMin);
      items = [...guaranteedFiller, ...cappedPrimary, ...remainingFiller];
    } else {
      items = this.#applySourceCaps(items, config.sources);
    }

    // Cap to allocation (non-wire always; wire only during decay)
    if (config.allocation != null) {
      items = items.slice(0, config.allocation);
    }

    return items;
  }

  /**
   * Identify sources marked as filler (role: 'filler').
   * Filler sources fill remaining slots after primary sources.
   */
  #getFillerSources(sourcesConfig) {
    const fillers = new Set();
    if (!sourcesConfig) return fillers;
    for (const [key, cfg] of Object.entries(sourcesConfig)) {
      if (cfg?.role === 'filler') fillers.add(key);
    }
    return fillers;
  }

  /**
   * Sum min_per_batch across all filler sources.
   * Guarantees fillers always get at least this many slots.
   */
  #getFillerMin(sourcesConfig, fillerSources) {
    let total = 0;
    for (const source of fillerSources) {
      total += sourcesConfig[source]?.min_per_batch ?? 0;
    }
    return total;
  }

  /**
   * Apply tier-level filters (read_status, staleness, recently_shown).
   * TODO: Implement filter strategies
   */
  #applyTierFilters(items, selection) {
    // Shell — filters not yet implemented
    // Each filter in selection.filter array would remove items
    // e.g. 'read_status' removes already-read articles
    // e.g. 'staleness' removes stale compass data
    // e.g. 'recently_shown' removes items shown in recent batches
    return items;
  }

  /**
   * Apply tier-level sort strategy.
   */
  #applyTierSort(items, selection, selectionCounts) {
    const sort = selection?.sort || 'timestamp_desc';

    switch (sort) {
      case 'timestamp_desc':
        return [...items].sort((a, b) => {
          const timeDiff = new Date(b.timestamp) - new Date(a.timestamp);
          // Within same hour, prefer lower selection count
          if (selectionCounts && Math.abs(timeDiff) < 3600000) {
            const aCount = selectionCounts.get(a.id)?.count || 0;
            const bCount = selectionCounts.get(b.id)?.count || 0;
            if (aCount !== bCount) return aCount - bCount;
          }
          return timeDiff;
        });

      case 'priority':
        return [...items].sort((a, b) =>
          (b.priority || 0) - (a.priority || 0));

      case 'random': {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      }

      default:
        return items;
    }
  }

  /**
   * Enforce per-source max_per_batch caps within a tier.
   */
  #applySourceCaps(items, sourcesConfig) {
    if (!sourcesConfig || Object.keys(sourcesConfig).length === 0) return items;

    const counts = {};
    return items.filter(item => {
      const cap = sourcesConfig[item.source]?.max_per_batch;
      if (cap == null) return true;
      counts[item.source] = (counts[item.source] || 0) + 1;
      return counts[item.source] <= cap;
    });
  }

  /**
   * Filter wire items to a focused source/subsource.
   */
  #applyFocusFilter(items, focus) {
    const [focusSource, focusSubsource] = focus.split(':');
    return items.filter(item => {
      if (item.source !== focusSource) return false;
      if (focusSubsource) {
        const subKey = item.meta?.subreddit || item.meta?.sourceId || item.meta?.feedTitle;
        if (subKey !== focusSubsource) return false;
      }
      return true;
    });
  }

  // ======================================================================
  // Level 1: Cross-Tier Interleaving
  // ======================================================================

  /**
   * Interleave non-wire items into the wire backbone at even intervals.
   *
   * @param {Object} selected - { wire: [...], library: [...], scrapbook: [...], compass: [...] }
   * @param {Object} tierConfig - Resolved tier config
   * @param {number} effectiveLimit - Target batch size
   * @returns {Object[]} Interleaved items
   */
  #interleave(selected, tierConfig, effectiveLimit) {
    const wire = selected[TIERS.WIRE] || [];

    // Collect all non-wire items in a single pool
    const nonWire = [
      ...(selected[TIERS.COMPASS] || []),
      ...(selected[TIERS.SCRAPBOOK] || []),
      ...(selected[TIERS.LIBRARY] || []),
    ];

    if (nonWire.length === 0) return wire.slice(0, effectiveLimit);
    if (wire.length === 0) return nonWire.slice(0, effectiveLimit);

    // Calculate spacing: distribute non-wire items evenly across wire backbone
    const interval = Math.max(1, Math.floor(wire.length / (nonWire.length + 1)));

    const result = [];
    let nonWireIdx = 0;

    for (let i = 0; i < wire.length; i++) {
      result.push(wire[i]);

      // Insert a non-wire item at regular intervals
      if ((i + 1) % interval === 0 && nonWireIdx < nonWire.length) {
        result.push(nonWire[nonWireIdx++]);
      }
    }

    // Append any remaining non-wire items
    while (nonWireIdx < nonWire.length) {
      result.push(nonWire[nonWireIdx++]);
    }

    return result;
  }

  // ======================================================================
  // Bucket Helpers
  // ======================================================================

  /**
   * Partition items into tier buckets based on item.tier field.
   */
  #bucketByTier(items) {
    const buckets = {
      [TIERS.WIRE]: [],
      [TIERS.LIBRARY]: [],
      [TIERS.SCRAPBOOK]: [],
      [TIERS.COMPASS]: [],
    };

    for (const item of items) {
      const tier = item.tier || TIERS.WIRE;
      if (buckets[tier]) {
        buckets[tier].push(item);
      } else {
        buckets[TIERS.WIRE].push(item);
      }
    }

    return buckets;
  }
}

export default TierAssemblyService;
