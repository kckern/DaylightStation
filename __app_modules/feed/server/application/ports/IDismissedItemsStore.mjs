/**
 * IDismissedItemsStore Port
 *
 * Interface for dismissed feed item persistence.
 * Tracks which feed items have been dismissed so they are excluded from
 * future batches.
 *
 * @module applications/feed/ports
 */

/**
 * @interface IDismissedItemsStore
 */
export class IDismissedItemsStore {
  /**
   * Load all dismissed item IDs (pruning expired entries as needed).
   *
   * @returns {Set<string>} Set of dismissed item IDs
   */
  load() {
    throw new Error('Not implemented');
  }

  /**
   * Add item IDs to the dismissed set.
   *
   * @param {string[]} feedItemIds - IDs of items to mark as dismissed
   */
  add(feedItemIds) {
    throw new Error('Not implemented');
  }

  /**
   * Clear the in-memory cache (called on pool reset).
   */
  clearCache() {
    throw new Error('Not implemented');
  }
}

export default IDismissedItemsStore;
