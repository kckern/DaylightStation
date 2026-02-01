// backend/src/2_domains/content/services/ItemSelectionService.mjs

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
}

export default ItemSelectionService;
