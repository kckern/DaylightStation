// backend/src/2_domains/content/services/ItemSelectionService.mjs
import { QueueService } from './QueueService.mjs';

/**
 * Named strategy presets for item selection.
 * Each strategy defines filter, sort, and pick operations.
 */
const STRATEGIES = {
  watchlist: {
    filter: ['skipAfter', 'waitUntil', 'hold', 'watched', 'days'],
    sort: 'priority',
    pick: 'first'
  },
  program: {
    filter: ['skipAfter', 'waitUntil', 'hold', 'days'],
    sort: 'source_order',
    pick: 'all'
  },
  binge: {
    filter: ['watched'],
    sort: 'source_order',
    pick: 'all'
  },
  sequential: {
    // For content you progress through in order (scripture, audiobooks)
    // Filters out fully watched, sorts by sequence, picks next item
    filter: ['watched'],
    sort: 'source_order',
    pick: 'first'
  },
  album: {
    filter: [],
    sort: 'track_order',
    pick: 'all'
  },
  playlist: {
    filter: [],
    sort: 'source_order',
    pick: 'all'
  },
  discovery: {
    filter: [],
    sort: 'random',
    pick: 'first'
  },
  chronological: {
    filter: [],
    sort: 'date_asc',
    pick: 'all'
  },
  slideshow: {
    filter: [],
    sort: 'random',
    pick: 'all'
  },
  freshvideo: {
    // For fresh video sources (news, teded, etc.)
    // Filters out watched, sorts by date (latest first) with source priority tiebreaker
    // Returns single item: the latest unwatched video from highest-priority source
    filter: ['watched'],
    sort: 'date_desc_priority',
    pick: 'first'
  }
};

/**
 * Inference rules: context signal -> strategy name
 */
const INFERENCE_RULES = [
  { match: (ctx) => ctx.containerType === 'watchlist', strategy: 'watchlist' },
  { match: (ctx) => ctx.containerType === 'program', strategy: 'program' },
  { match: (ctx) => ctx.containerType === 'folder', strategy: 'watchlist' }, // legacy alias, maps to watchlist
  { match: (ctx) => ctx.containerType === 'sequential', strategy: 'sequential' }, // scripture, audiobooks
  { match: (ctx) => ctx.containerType === 'conference', strategy: 'sequential' }, // talk conferences: skip watched, source order, pick first
  { match: (ctx) => ctx.containerType === 'freshvideo', strategy: 'freshvideo' }, // news, teded, etc.
  { match: (ctx) => ctx.containerType === 'album', strategy: 'album' },
  { match: (ctx) => ctx.containerType === 'playlist', strategy: 'playlist' },
  { match: (ctx) => ctx.query?.person, strategy: 'chronological' },
  { match: (ctx) => ctx.query?.time, strategy: 'chronological' },
  { match: (ctx) => ctx.query?.text, strategy: 'discovery' },
  { match: (ctx) => ctx.action === 'display', strategy: 'slideshow' }
];

/**
 * Filter type to QueueService method mapping.
 */
const FILTER_METHODS = {
  skipAfter: (items, ctx) => QueueService.filterBySkipAfter(items, ctx.now),
  waitUntil: (items, ctx) => QueueService.filterByWaitUntil(items, ctx.now),
  hold: (items) => QueueService.filterByHold(items),
  watched: (items) => QueueService.filterByWatched(items),
  days: (items, ctx) => QueueService.filterByDayOfWeek(items, ctx.now)
};

/**
 * Filters that require a date.
 */
const DATE_REQUIRED_FILTERS = ['skipAfter', 'waitUntil', 'days'];

/**
 * Sort methods.
 */
const SORT_METHODS = {
  priority: (items) => QueueService.sortByPriority(items),

  track_order: (items) => {
    return [...items].sort((a, b) => {
      const discA = a.discNumber ?? 1;
      const discB = b.discNumber ?? 1;
      if (discA !== discB) return discA - discB;

      const trackA = a.trackNumber ?? a.itemIndex ?? 0;
      const trackB = b.trackNumber ?? b.itemIndex ?? 0;
      return trackA - trackB;
    });
  },

  source_order: (items) => [...items],

  date_asc: (items) => {
    return [...items].sort((a, b) => {
      const dateA = a.date || a.takenAt || '';
      const dateB = b.date || b.takenAt || '';
      return dateA.localeCompare(dateB);
    });
  },

  date_desc: (items) => {
    return [...items].sort((a, b) => {
      const dateA = a.date || a.takenAt || '';
      const dateB = b.date || b.takenAt || '';
      return dateB.localeCompare(dateA);
    });
  },

  date_desc_priority: (items) => {
    // Sort by date descending (latest first), then by sourcePriority ascending (lower = higher priority)
    // Used for freshvideo strategy: picks latest video, but if dates match, prefers higher-priority source
    return [...items].sort((a, b) => {
      const dateA = a.date || a.takenAt || '';
      const dateB = b.date || b.takenAt || '';
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      // Tiebreaker: source priority (lower index = higher priority)
      const priorityA = a.sourcePriority ?? 999;
      const priorityB = b.sourcePriority ?? 999;
      return priorityA - priorityB;
    });
  },

  random: (items) => {
    // Fisher-Yates shuffle
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },

  title: (items) => {
    return [...items].sort((a, b) => {
      const titleA = a.title || '';
      const titleB = b.title || '';
      return titleA.localeCompare(titleB);
    });
  }
};

/**
 * ItemSelectionService provides unified item selection logic for content queries.
 * Pure domain service with no I/O dependencies.
 *
 * @class ItemSelectionService
 */
export class ItemSelectionService {
  /**
   * Get a named strategy preset.
   *
   * @param {string} name - Strategy name
   * @returns {{ filter: string[], sort: string, pick: string }}
   * @throws {Error} If strategy name is unknown
   */
  static getStrategy(name) {
    const strategy = STRATEGIES[name];
    if (!strategy) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    return { ...strategy };
  }

  /**
   * Apply a single named filter to items.
   *
   * @param {Array} items - Items to filter
   * @param {string} filterName - Filter name (skipAfter, waitUntil, hold, watched, days)
   * @param {Object} context - Filter context
   * @param {Date} context.now - Current date (required for date-dependent filters)
   * @returns {Array} Filtered items
   * @throws {Error} If filter is unknown or required context missing
   */
  static applyFilter(items, filterName, context) {
    const filterFn = FILTER_METHODS[filterName];
    if (!filterFn) {
      throw new Error(`Unknown filter: ${filterName}`);
    }
    if (DATE_REQUIRED_FILTERS.includes(filterName) && (!context.now || !(context.now instanceof Date))) {
      throw new Error('now date required for date-dependent filters');
    }
    return filterFn(items, context);
  }

  /**
   * Apply multiple named filters to items in sequence.
   *
   * @param {Array} items - Items to filter
   * @param {string[]} filterNames - Filter names to apply
   * @param {Object} context - Filter context
   * @returns {Array} Filtered items
   */
  static applyFilters(items, filterNames, context) {
    return filterNames.reduce(
      (result, filterName) => this.applyFilter(result, filterName, context),
      items
    );
  }

  /**
   * Apply a named sort to items.
   *
   * @param {Array} items - Items to sort
   * @param {string} sortName - Sort name (priority, track_order, source_order, date_asc, date_desc, random, title)
   * @returns {Array} Sorted items (new array)
   * @throws {Error} If sort is unknown
   */
  static applySort(items, sortName) {
    const sortFn = SORT_METHODS[sortName];
    if (!sortFn) {
      throw new Error(`Unknown sort: ${sortName}`);
    }
    return sortFn(items);
  }

  /**
   * Apply a pick operation to select subset of items.
   *
   * @param {Array} items - Items to pick from
   * @param {string} pickType - Pick type (first, all, random, take:N)
   * @returns {Array} Selected items
   * @throws {Error} If pick type is unknown or invalid format
   */
  static applyPick(items, pickType) {
    if (items.length === 0) return [];

    if (pickType === 'first') {
      return [items[0]];
    }

    if (pickType === 'all') {
      return [...items];
    }

    if (pickType === 'random') {
      const index = Math.floor(Math.random() * items.length);
      return [items[index]];
    }

    if (pickType.startsWith('take:')) {
      const n = parseInt(pickType.slice(5), 10);
      if (isNaN(n)) {
        throw new Error('Invalid take format: expected take:N where N is a number');
      }
      return items.slice(0, n);
    }

    throw new Error(`Unknown pick: ${pickType}`);
  }

  /**
   * Resolve a strategy from context and overrides.
   * Resolution order: inference -> explicit strategy -> individual overrides
   *
   * @param {Object} context - Selection context
   * @param {string} [context.action] - play, queue, display, list, read
   * @param {string} [context.containerType] - watchlist, album, playlist, search
   * @param {Object} [context.query] - Query filters (person, time, text)
   * @param {Object} [overrides] - Explicit overrides
   * @param {string} [overrides.strategy] - Named strategy to use
   * @param {string} [overrides.sort] - Override sort only
   * @param {string} [overrides.pick] - Override pick only
   * @param {string} [overrides.filter] - 'none' to disable filtering
   * @returns {{ name: string, filter: string[], sort: string, pick: string }}
   */
  static resolveStrategy(context, overrides = {}) {
    // 1. Infer base strategy from context
    let strategyName = 'discovery'; // default
    for (const rule of INFERENCE_RULES) {
      if (rule.match(context)) {
        strategyName = rule.strategy;
        break;
      }
    }

    // 2. Override with explicit strategy if provided
    if (overrides.strategy) {
      strategyName = overrides.strategy;
    }

    // 3. Get base strategy
    const strategy = this.getStrategy(strategyName);

    // 4. Apply individual overrides
    if (overrides.filter === 'none') {
      strategy.filter = [];
    }
    if (overrides.sort) {
      strategy.sort = overrides.sort;
    }
    if (overrides.pick) {
      strategy.pick = overrides.pick;
    }

    // Include strategy name in result
    strategy.name = strategyName;

    return strategy;
  }

  /**
   * Select items based on context and strategy.
   * Main entry point for item selection.
   *
   * @param {Array} items - Pre-enriched items (with metadata.percent, etc.)
   * @param {Object} context - Selection context
   * @param {string} [context.action] - play, queue, display, list, read
   * @param {string} [context.containerType] - watchlist, album, playlist, search
   * @param {Object} [context.query] - Query filters used (person, time, text)
   * @param {Date} context.now - Current date (required for filtering)
   * @param {Object} [overrides] - Explicit strategy overrides
   * @param {boolean} [overrides.allowFallback] - Enable fallback cascade for empty results
   * @returns {Array} Selected items
   */
  static select(items, context, overrides = {}) {
    const strategy = this.resolveStrategy(context, overrides);

    // Apply urgency promotion for watchlist-like strategies
    let processed = items;
    if (strategy.filter.includes('skipAfter') && context.now) {
      processed = QueueService.applyUrgency(processed, context.now);
    }

    // Filter with optional fallback
    if (strategy.filter.length > 0) {
      if (!context.now || !(context.now instanceof Date)) {
        throw new Error('now date required for filtering');
      }
      processed = this.#applyFiltersWithFallback(
        processed,
        strategy.filter,
        context,
        overrides.allowFallback
      );
    }

    // Sort
    processed = this.applySort(processed, strategy.sort);

    // Pick
    processed = this.applyPick(processed, strategy.pick);

    return processed;
  }

  /**
   * Apply filters with fallback cascade.
   * If result is empty and allowFallback, progressively relax filters.
   * @private
   */
  static #applyFiltersWithFallback(items, filters, context, allowFallback) {
    // Define which filters to relax in order
    const relaxOrder = ['skipAfter', 'hold', 'watched', 'waitUntil'];

    let result = this.applyFilters(items, filters, context);

    if (result.length > 0 || !allowFallback) {
      return result;
    }

    // Progressive relaxation
    let activeFilters = [...filters];
    for (const filterToRelax of relaxOrder) {
      if (activeFilters.includes(filterToRelax)) {
        activeFilters = activeFilters.filter(f => f !== filterToRelax);
        result = this.applyFilters(items, activeFilters, context);
        if (result.length > 0) {
          return result;
        }
      }
    }

    return result;
  }
}

export default ItemSelectionService;
