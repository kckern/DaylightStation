// backend/src/3_applications/content/ports/IWatchStateDatastore.mjs

/**
 * Port interface for WatchState persistence
 * @class IWatchStateDatastore
 */
export class IWatchStateDatastore {
  /**
   * Get watch state for an item
   * @param {string} itemId - Item identifier
   * @param {string} storagePath - Storage path
   * @returns {Promise<import('../../../1_domains/content/entities/WatchState.mjs').WatchState|null>}
   */
  async get(itemId, storagePath) {
    throw new Error('IWatchStateDatastore.get must be implemented');
  }

  /**
   * Set watch state for an item
   * @param {import('../../../1_domains/content/entities/WatchState.mjs').WatchState} watchState - Watch state to save
   * @param {string} storagePath - Storage path
   * @returns {Promise<void>}
   */
  async set(watchState, storagePath) {
    throw new Error('IWatchStateDatastore.set must be implemented');
  }

  /**
   * Get all watch states for a storage path
   * @param {string} storagePath - Storage path
   * @returns {Promise<import('../../../1_domains/content/entities/WatchState.mjs').WatchState[]>}
   */
  async getAll(storagePath) {
    throw new Error('IWatchStateDatastore.getAll must be implemented');
  }

  /**
   * Clear all watch states for a storage path
   * @param {string} storagePath - Storage path
   * @returns {Promise<void>}
   */
  async clear(storagePath) {
    throw new Error('IWatchStateDatastore.clear must be implemented');
  }
}

/**
 * Validates that an object implements the IWatchStateDatastore interface
 * @param {any} store
 * @throws {Error} If validation fails
 */
export function validateWatchStateDatastore(store) {
  if (typeof store.get !== 'function') {
    throw new Error('WatchStateDatastore must implement get(itemId, storagePath): Promise<WatchState|null>');
  }
  if (typeof store.set !== 'function') {
    throw new Error('WatchStateDatastore must implement set(watchState, storagePath): Promise<void>');
  }
  if (typeof store.getAll !== 'function') {
    throw new Error('WatchStateDatastore must implement getAll(storagePath): Promise<WatchState[]>');
  }
  if (typeof store.clear !== 'function') {
    throw new Error('WatchStateDatastore must implement clear(storagePath): Promise<void>');
  }
}
