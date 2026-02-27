/**
 * IMediaQueueDatastore - Port interface for media queue persistence
 *
 * Abstracts the storage mechanism for MediaQueue entities.
 * Implementations handle the actual persistence (YAML files, database, etc.)
 */

export class IMediaQueueDatastore {
  /**
   * Load a media queue for a household.
   * @param {string} householdId - Household identifier
   * @returns {Promise<import('#domains/media/entities/MediaQueue.mjs').MediaQueue|null>}
   *   The deserialized MediaQueue, or null if no queue exists.
   */
  async load(householdId) {
    throw new Error('IMediaQueueDatastore.load must be implemented');
  }

  /**
   * Save a media queue for a household.
   * @param {import('#domains/media/entities/MediaQueue.mjs').MediaQueue} mediaQueue - Queue to persist
   * @param {string} householdId - Household identifier
   * @returns {Promise<void>}
   */
  async save(mediaQueue, householdId) {
    throw new Error('IMediaQueueDatastore.save must be implemented');
  }
}

export default IMediaQueueDatastore;
