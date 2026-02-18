// backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs

/**
 * Canonical content-type tokens used by feed adapters.
 * Each adapter declares which types it can supply via the `provides` getter.
 * @readonly
 * @enum {string}
 */
export const CONTENT_TYPES = Object.freeze({
  FEEDS:        'feeds',
  NEWS:         'news',
  SOCIAL:       'social',
  PHOTOS:       'photos',
  COMICS:       'comics',
  EBOOKS:       'ebooks',
  AUDIO:        'audio',
  VIDEO:        'video',
  JOURNAL:      'journal',
  BOOK_REVIEWS: 'book-reviews',
  TASKS:        'tasks',
  WEATHER:      'weather',
  HEALTH:       'health',
  FITNESS:      'fitness',
  GRATITUDE:    'gratitude',
  ENTROPY:      'entropy',
  SCRIPTURE:    'scripture',
});

export class IFeedSourceAdapter {
  get sourceType() {
    throw new Error('IFeedSourceAdapter.sourceType must be implemented');
  }

  /**
   * Content types this adapter can supply.
   * Subclasses should override to return an array of CONTENT_TYPES values.
   * @returns {string[]}
   */
  get provides() {
    return [];
  }

  /**
   * Fetch a page of items from this source.
   *
   * @param {Object} query - Query config object from YAML
   * @param {string} username - Current user
   * @param {Object} [options]
   * @param {string|null} [options.cursor] - Opaque cursor from a previous fetchPage call
   * @returns {Promise<{ items: Object[], cursor: string|null }>}
   *   cursor is null when no more pages are available.
   */
  async fetchPage(query, username, { cursor } = {}) {
    // Default implementation: delegate to legacy fetchItems, no cursor
    const items = await this.fetchItems(query, username);
    return { items, cursor: null };
  }

  /**
   * @deprecated Use fetchPage instead. Kept for backwards compatibility.
   */
  async fetchItems(query, username) {
    throw new Error('IFeedSourceAdapter.fetchItems must be implemented');
  }

  async getDetail(localId, meta, username) {
    return null;
  }

  /**
   * Mark items as read/consumed. No-op by default.
   * @param {string[]} itemIds - Prefixed item IDs (e.g. "freshrss:12345")
   * @param {string} username
   */
  async markRead(itemIds, username) {
    // No-op default — sources without read-state tracking ignore this
  }
}

export function isFeedSourceAdapter(obj) {
  return obj &&
    typeof obj.sourceType === 'string' &&
    (typeof obj.fetchPage === 'function' || typeof obj.fetchItems === 'function');
}
