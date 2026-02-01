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
  binge: {
    filter: ['watched'],
    sort: 'source_order',
    pick: 'all'
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
  }
};

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
}

export default ItemSelectionService;
