// backend/src/3_applications/content/ports/IMediaProgressMemory.mjs

/**
 * Port interface for MediaProgress persistence
 * @class IMediaProgressMemory
 */
export class IMediaProgressMemory {
  /**
   * Get media progress for an item
   * @param {string} itemId - Item identifier
   * @param {string} storagePath - Storage path
   * @returns {Promise<import('../../../1_domains/content/entities/MediaProgress.mjs').MediaProgress|null>}
   */
  async get(itemId, storagePath) {
    throw new Error('IMediaProgressMemory.get must be implemented');
  }

  /**
   * Set media progress for an item
   * @param {import('../../../1_domains/content/entities/MediaProgress.mjs').MediaProgress} mediaProgress - Media progress to save
   * @param {string} storagePath - Storage path
   * @returns {Promise<void>}
   */
  async set(mediaProgress, storagePath) {
    throw new Error('IMediaProgressMemory.set must be implemented');
  }

  /**
   * Get all media progress records for a storage path
   * @param {string} storagePath - Storage path
   * @returns {Promise<import('../../../1_domains/content/entities/MediaProgress.mjs').MediaProgress[]>}
   */
  async getAll(storagePath) {
    throw new Error('IMediaProgressMemory.getAll must be implemented');
  }

  /**
   * Clear all media progress records for a storage path
   * @param {string} storagePath - Storage path
   * @returns {Promise<void>}
   */
  async clear(storagePath) {
    throw new Error('IMediaProgressMemory.clear must be implemented');
  }
}

/**
 * Validates that an object implements the IMediaProgressMemory interface
 * @param {any} store
 * @throws {Error} If validation fails
 */
export function validateMediaProgressMemory(store) {
  if (typeof store.get !== 'function') {
    throw new Error('MediaProgressMemory must implement get(itemId, storagePath): Promise<MediaProgress|null>');
  }
  if (typeof store.set !== 'function') {
    throw new Error('MediaProgressMemory must implement set(mediaProgress, storagePath): Promise<void>');
  }
  if (typeof store.getAll !== 'function') {
    throw new Error('MediaProgressMemory must implement getAll(storagePath): Promise<MediaProgress[]>');
  }
  if (typeof store.clear !== 'function') {
    throw new Error('MediaProgressMemory must implement clear(storagePath): Promise<void>');
  }
}

export default IMediaProgressMemory;
