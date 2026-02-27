/**
 * IMediaQueueDatastore - Port interface for media queue persistence
 *
 * Lives in the domain layer (2_domains) so both the adapter layer (1_adapters)
 * and the application layer (3_applications) can depend on it without violating
 * the dependency rule.
 *
 * The adapter implements this interface. The service depends on this interface.
 * Neither depends on the other.
 */

export class IMediaQueueDatastore {
  /**
   * Load a media queue for a household.
   * @param {string} householdId - Household identifier
   * @returns {Promise<import('../entities/MediaQueue.mjs').MediaQueue|null>}
   *   The deserialized MediaQueue, or null if no queue exists.
   */
  async load(householdId) {
    throw new Error('IMediaQueueDatastore.load must be implemented');
  }

  /**
   * Save a media queue for a household.
   * @param {import('../entities/MediaQueue.mjs').MediaQueue} mediaQueue - Queue to persist
   * @param {string} householdId - Household identifier
   * @returns {Promise<void>}
   */
  async save(mediaQueue, householdId) {
    throw new Error('IMediaQueueDatastore.save must be implemented');
  }
}

export default IMediaQueueDatastore;
