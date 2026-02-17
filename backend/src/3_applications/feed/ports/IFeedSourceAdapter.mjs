// backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
/**
 * IFeedSourceAdapter — port interface for feed content sources.
 *
 * Each adapter fetches items from one external system (Reddit, Plex, weather, etc.)
 * and returns normalized FeedItem-shaped objects.
 *
 * @module applications/feed/ports/IFeedSourceAdapter
 */
export class IFeedSourceAdapter {
  /**
   * @returns {string} Source type identifier (matches query YAML `type` field)
   */
  get sourceType() {
    throw new Error('IFeedSourceAdapter.sourceType must be implemented');
  }

  /**
   * Fetch items for this source.
   *
   * @param {Object} query - Query config object from YAML
   * @param {string} username - Current user
   * @returns {Promise<Object[]>} Array of normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    throw new Error('IFeedSourceAdapter.fetchItems must be implemented');
  }

  /**
   * Fetch detail content for a specific item.
   * Optional — adapters that don't support detail return null.
   *
   * @param {string} localId - The local portion of the item ID
   * @param {Object} meta - The item's meta object from the scroll response
   * @param {string} username - Current user
   * @returns {Promise<{ sections: Array<{ type: string, data: Object }> } | null>}
   */
  async getDetail(localId, meta, username) {
    return null;
  }
}

/**
 * Duck-type check for IFeedSourceAdapter compliance.
 * @param {Object} obj
 * @returns {boolean}
 */
export function isFeedSourceAdapter(obj) {
  return obj &&
    typeof obj.sourceType === 'string' &&
    typeof obj.fetchItems === 'function';
}
