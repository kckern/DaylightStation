// backend/src/3_applications/content/ports/IMediaProgressMemory.mjs

/**
 * Port interface for MediaProgress persistence
 * @class IMediaProgressMemory
 */
export class IMediaProgressMemory {
  /**
   * Get media progress for an item
   * @param {string} contentId - Content identifier
   * @param {string} namespaceId - Opaque progress partition identifier
   * @returns {Promise<import('#domains/content/entities/MediaProgress.mjs').MediaProgress|null>}
   */
  async findProgress(contentId, namespaceId) {
    throw new Error('IMediaProgressMemory.findProgress must be implemented');
  }

  /**
   * Set media progress for an item
   * @param {import('#domains/content/entities/MediaProgress.mjs').MediaProgress} mediaProgress - Media progress to save
   * @param {string} namespaceId - Opaque progress partition identifier
   * @returns {Promise<void>}
   */
  async saveProgress(mediaProgress, namespaceId) {
    throw new Error('IMediaProgressMemory.saveProgress must be implemented');
  }

  /**
   * Get all media progress records in a logical partition
   * @param {string} namespaceId - Opaque progress partition identifier
   * @returns {Promise<import('#domains/content/entities/MediaProgress.mjs').MediaProgress[]>}
   */
  async listProgress(namespaceId) {
    throw new Error('IMediaProgressMemory.listProgress must be implemented');
  }

  /**
   * Clear all media progress records in a logical partition
   * @param {string} namespaceId - Opaque progress partition identifier
   * @returns {Promise<void>}
   */
  async clearProgress(namespaceId) {
    throw new Error('IMediaProgressMemory.clearProgress must be implemented');
  }

  /**
   * List progress across every partition owned by a content source.
   * @param {string} sourceId
   */
  async listSourceProgress(sourceId) {
    throw new Error('IMediaProgressMemory.listSourceProgress must be implemented');
  }
}

/**
 * Validates that an object implements the IMediaProgressMemory interface
 * @param {any} store
 * @throws {Error} If validation fails
 */
export function validateMediaProgressMemory(store) {
  if (typeof store.findProgress !== 'function') {
    throw new Error('MediaProgressMemory must implement findProgress(contentId, namespaceId)');
  }
  if (typeof store.saveProgress !== 'function') {
    throw new Error('MediaProgressMemory must implement saveProgress(mediaProgress, namespaceId)');
  }
  if (typeof store.listProgress !== 'function') {
    throw new Error('MediaProgressMemory must implement listProgress(namespaceId)');
  }
  if (typeof store.clearProgress !== 'function') {
    throw new Error('MediaProgressMemory must implement clearProgress(namespaceId)');
  }
  if (typeof store.listSourceProgress !== 'function') {
    throw new Error('MediaProgressMemory must implement listSourceProgress(sourceId)');
  }
}

export default IMediaProgressMemory;
