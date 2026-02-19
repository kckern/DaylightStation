// backend/src/3_applications/feed/services/TierAssemblyService.mjs
/**
 * TierAssemblyService
 *
 * Four-tier feed assembly: wire, library, scrapbook, compass.
 * Replaces the two-tier (external/grounding) interleaving model.
 *
 * Level 1 — Batch distribution: FlexAllocator distributes slots across tiers.
 * Level 2 — Within-tier selection: filter → sort → pick per tier strategy.
 *
 * Wire fills remaining slots after other tiers are allocated.
 * Non-wire items are interleaved into the wire backbone with spacing.
 *
 * @module applications/feed/services
 */

import { FlexAllocator } from './FlexAllocator.mjs';
import { FlexConfigParser } from './FlexConfigParser.mjs';

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
  #sourceResolver;
  #logger;

  constructor({ spacingEnforcer = null, sourceResolver = null, logger = console } = {}) {
    this.#spacingEnforcer = spacingEnforcer;
    this.#sourceResolver = sourceResolver;
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
    const halfLife = scrollConfig.wire_decay_half_life ?? 4;

    // Bucket items by tier
    const buckets = this.#bucketByTier(allItems);

    // Level 1: FlexAllocator distributes slots across tiers
    let tierSlots = this.#allocateTierSlots(tierConfig, effectiveLimit, buckets);

    // Apply wire decay: half-life exponential decay after flex allocation
    tierSlots = this.#applyWireDecay(tierSlots, batchNumber, halfLife, buckets);

    // Level 2: within-tier selection
    const selected = {};
    for (const tier of Object.values(TIERS)) {
      const candidates = buckets[tier] || [];
      const config = tierConfig[tier] || TIER_DEFAULTS[tier];
      const slots = tierSlots.get(tier);
      selected[tier] = this.#selectForTier(tier, candidates, config, { focus, selectionCounts, tierSlots: slots });
    }

    // Post-selection redistribution: if a tier selected fewer items than
    // allocated (pool exhausted after dedup/filters), give the shortfall
    // to non-wire tiers that have spare capacity, then re-select.
    tierSlots = this.#redistributeShortfall(tierSlots, selected, buckets, tierConfig, { focus, selectionCounts });

    // Cross-tier interleave
    const interleaved = this.#interleave(selected, tierConfig, effectiveLimit);

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

    // Build feed_assembly stats for debugging/auditing
    const decayFactor = Math.pow(0.5, (batchNumber - 1) / halfLife);
    const feed_assembly = {
      batchNumber,
      wireDecayFactor: parseFloat(decayFactor.toFixed(3)),
      halfLife,
      batchSize: effectiveLimit,
      tiers: {},
    };
    for (const tier of Object.values(TIERS)) {
      const tierItems = selected[tier] || [];
      const sources = {};
      for (const item of tierItems) {
        sources[item.source] = (sources[item.source] || 0) + 1;
      }
      feed_assembly.tiers[tier] = {
        allocated: tierSlots.get(tier) ?? 0,
        selected: tierItems.length,
        sources,
      };
    }

    this.#logger.info?.('tier.assembly.batch', feed_assembly);

    return {
      items,
      hasMore: spaced.length > effectiveLimit,
      feed_assembly,
    };
  }

  // ======================================================================
  // Tier Configuration
  // ======================================================================

  /**
   * Merge user scroll config tiers with defaults.
   * Parses each tier through FlexConfigParser to produce flex descriptors.
   *
   * @param {Object} scrollConfig
   * @returns {Object} Resolved tier config keyed by tier name
   */
  #resolveTierConfig(scrollConfig) {
    const userTiers = scrollConfig.tiers || {};
    const batchSize = scrollConfig.batch_size || 50;
    const resolved = {};

    for (const tier of Object.values(TIERS)) {
      const defaults = TIER_DEFAULTS[tier] || {};
      const user = userTiers[tier] || {};

      // Build a merged node for FlexConfigParser (user overrides defaults)
      const mergedNode = { ...defaults, ...user };
      const flex = FlexConfigParser.parseFlexNode(mergedNode, batchSize);

      // Wire tier defaults: grow=1, basis='auto' so it fills remaining space
      if (tier === TIERS.WIRE && user.flex === undefined && user.allocation === undefined) {
        flex.grow = flex.grow || 1;
        if (flex.basis !== 'auto' && defaults.allocation === undefined) {
          flex.basis = 'auto';
        }
      }

      resolved[tier] = {
        allocation: user.allocation ?? defaults.allocation,
        flex,
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
  // Flex Allocation
  // ======================================================================

  /**
   * Use FlexAllocator to determine how many slots each tier gets.
   *
   * @param {Object} tierConfig - Resolved tier config (with .flex descriptors)
   * @param {number} batchSize - Target batch size
   * @param {Object} buckets - Items bucketed by tier
   * @returns {Map<string, number>} Tier → slot count
   */
  #allocateTierSlots(tierConfig, batchSize, buckets) {
    const children = Object.values(TIERS).map(tier => {
      const cfg = tierConfig[tier] || {};
      const flex = cfg.flex || {};
      return {
        key: tier,
        grow: flex.grow ?? (tier === TIERS.WIRE ? 1 : 0),
        shrink: flex.shrink ?? 1,
        basis: flex.basis ?? (tier === TIERS.WIRE ? 'auto' : 'auto'),
        min: flex.min ?? 0,
        max: flex.max ?? Infinity,
        available: (buckets[tier] || []).length,
      };
    });
    return FlexAllocator.distribute(batchSize, children);
  }

  // ======================================================================
  // Wire Decay
  // ======================================================================

  /**
   * Apply half-life exponential decay to wire slots after FlexAllocator.
   * Freed wire slots are distributed proportionally to non-wire tiers,
   * capped at each tier's available pool size. Overflow cascades to
   * tiers that still have capacity.
   *
   * Formula: decayFactor = 0.5 ^ ((batchNumber - 1) / halfLife)
   *   Batch 1: 100% wire  |  Batch 3 (hl=2): 50%  |  Batch 5: 25%
   *
   * @param {Map<string, number>} tierSlots - FlexAllocator output
   * @param {number} batchNumber - Current batch (1-indexed)
   * @param {number} halfLife - Batches until wire halves
   * @param {Object} buckets - Items bucketed by tier (for available counts)
   * @returns {Map<string, number>} Adjusted tier slots
   */
  #applyWireDecay(tierSlots, batchNumber, halfLife, buckets = {}) {
    if (halfLife <= 0 || batchNumber <= 1) return tierSlots;

    const baseWire = tierSlots.get(TIERS.WIRE) || 0;
    if (baseWire === 0) return tierSlots;

    const decayFactor = Math.pow(0.5, (batchNumber - 1) / halfLife);
    const decayedWire = Math.round(baseWire * decayFactor);
    let freed = baseWire - decayedWire;

    if (freed === 0) return tierSlots;

    // Collect non-wire tiers with their current slots and available pool sizes
    const nonWire = [];
    let totalNonWire = 0;
    for (const tier of Object.values(TIERS)) {
      if (tier === TIERS.WIRE) continue;
      const slots = tierSlots.get(tier) || 0;
      const available = (buckets[tier] || []).length;
      nonWire.push({ tier, slots, available });
      totalNonWire += slots;
    }

    const result = new Map(tierSlots);
    result.set(TIERS.WIRE, decayedWire);

    // Distribute freed slots, capping at pool size and cascading overflow
    if (totalNonWire > 0) {
      // First pass: proportional share capped at available
      let distributed = 0;
      let overflow = 0;
      for (let i = 0; i < nonWire.length; i++) {
        const { tier, slots, available } = nonWire[i];
        const rawShare = i === nonWire.length - 1
          ? freed - distributed
          : Math.round(freed * slots / totalNonWire);
        const newSlots = slots + rawShare;
        const capped = Math.min(newSlots, available);
        overflow += newSlots - capped;
        result.set(tier, capped);
        distributed += rawShare;
      }

      // Second pass: distribute overflow to tiers with remaining capacity
      while (overflow > 0) {
        let absorbed = 0;
        for (const { tier, available } of nonWire) {
          if (overflow <= 0) break;
          const current = result.get(tier);
          const headroom = available - current;
          if (headroom > 0) {
            const take = Math.min(headroom, overflow);
            result.set(tier, current + take);
            overflow -= take;
            absorbed += take;
          }
        }
        if (absorbed === 0) break; // no tier can absorb more
      }
    }

    return result;
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
   * @param {number} [options.tierSlots] - Flex-allocated slot count for this tier
   * @returns {Object[]} Selected items for this tier
   */
  #selectForTier(tier, candidates, config, { focus, selectionCounts, tierSlots } = {}) {
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

    // Prefer unseen items; seen items serve as fallback to fill allocation.
    // Preserves sort order within each group (unseen sorted first, then seen).
    const unseen = items.filter(i => !i._seen);
    const seen = items.filter(i => i._seen);
    items = [...unseen, ...seen];

    // Cap to flex-allocated slot count (replaces legacy config.allocation)
    const slotCap = tierSlots ?? config.allocation;
    if (slotCap != null) {
      items = items.slice(0, slotCap);
    }

    return items;
  }

  /**
   * Identify sources marked as filler.
   * Detects both flex format (`flex: 'filler'`) and legacy (`role: 'filler'`).
   */
  #getFillerSources(sourcesConfig) {
    const fillers = new Set();
    if (!sourcesConfig) return fillers;
    for (const [key, cfg] of Object.entries(sourcesConfig)) {
      if (cfg?.role === 'filler' || cfg?.flex === 'filler') fillers.add(key);
    }
    return fillers;
  }

  /**
   * Sum min across all filler sources.
   * Reads `min` (flex format) with fallback to `min_per_batch` (legacy format).
   */
  #getFillerMin(sourcesConfig, fillerSources) {
    let total = 0;
    for (const source of fillerSources) {
      const cfg = sourcesConfig[source];
      total += cfg?.min ?? cfg?.min_per_batch ?? 0;
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
   * Enforce per-source caps within a tier.
   * Reads `max` (flex format) with fallback to `max_per_batch` (legacy format).
   */
  #applySourceCaps(items, sourcesConfig) {
    if (!sourcesConfig || Object.keys(sourcesConfig).length === 0) return items;

    const counts = {};
    return items.filter(item => {
      const cfg = sourcesConfig[item.source];
      const cap = cfg?.max ?? cfg?.max_per_batch;
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

  /**
   * After initial selection, redistribute unfilled slots from exhausted tiers
   * to non-wire tiers with spare capacity, then re-select for those tiers.
   */
  #redistributeShortfall(tierSlots, selected, buckets, tierConfig, selectOpts) {
    let totalShortfall = 0;
    const shortfalls = new Map();
    for (const tier of Object.values(TIERS)) {
      const allocated = tierSlots.get(tier) || 0;
      const actual = (selected[tier] || []).length;
      if (actual < allocated) {
        shortfalls.set(tier, allocated - actual);
        totalShortfall += allocated - actual;
      }
    }
    if (totalShortfall === 0) return tierSlots;

    const result = new Map(tierSlots);
    // Shrink exhausted tiers to their actual selection
    for (const [tier, gap] of shortfalls) {
      result.set(tier, (tierSlots.get(tier) || 0) - gap);
    }

    // Distribute shortfall to non-wire tiers with spare capacity
    let remaining = totalShortfall;
    for (const tier of [TIERS.SCRAPBOOK, TIERS.LIBRARY, TIERS.COMPASS]) {
      if (remaining <= 0) break;
      if (shortfalls.has(tier)) continue; // this tier is exhausted
      const current = result.get(tier) || 0;
      const poolSize = (buckets[tier] || []).length;
      const headroom = poolSize - current;
      if (headroom > 0) {
        const take = Math.min(headroom, remaining);
        result.set(tier, current + take);
        remaining -= take;
        // Re-select with expanded allocation
        const config = tierConfig[tier] || TIER_DEFAULTS[tier];
        selected[tier] = this.#selectForTier(tier, buckets[tier] || [], config,
          { ...selectOpts, tierSlots: current + take });
      }
    }

    return result;
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
