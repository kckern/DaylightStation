/**
 * Port interface for feed item selection tracking.
 * Tracks how many times items have been selected into batches.
 * Generic — usable by any feed source, not just headlines.
 *
 * @module applications/feed/ports
 */
export class ISelectionTrackingStore {
  /**
   * Get all tracking records for a user.
   * @param {string} username
   * @returns {Promise<Map<string, { count: number, last: string }>>}
   */
  async getAll(username) {
    throw new Error('Not implemented');
  }

  /**
   * Increment selection count for a batch of item IDs.
   * @param {string[]} feedItemIds - Short IDs of items selected into a batch
   * @param {string} username
   * @returns {Promise<void>}
   */
  async incrementBatch(feedItemIds, username) {
    throw new Error('Not implemented');
  }
}

export default ISelectionTrackingStore;
