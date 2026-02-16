/**
 * IHeadlineStore Port
 *
 * Interface for headline cache persistence.
 * Stores per-source headline YAML files.
 *
 * @module applications/feed/ports
 */

/**
 * @interface IHeadlineStore
 */
export class IHeadlineStore {
  /**
   * Load cached headlines for a single source
   *
   * @param {string} sourceId - Feed source identifier (e.g. 'cnn', 'bbc')
   * @param {string} username - User identifier
   * @returns {Promise<Array<Object>>} Array of headline objects
   */
  async loadSource(sourceId, username) {
    throw new Error('Not implemented');
  }

  /**
   * Save headlines for a single source
   *
   * @param {string} sourceId - Feed source identifier
   * @param {Array<Object>} data - Array of headline objects to persist
   * @param {string} username - User identifier
   * @returns {Promise<void>}
   */
  async saveSource(sourceId, data, username) {
    throw new Error('Not implemented');
  }

  /**
   * Load cached headlines from all sources for a user
   *
   * @param {string} username - User identifier
   * @returns {Promise<Object>} Map of sourceId to headline arrays
   */
  async loadAllSources(username) {
    throw new Error('Not implemented');
  }

  /**
   * Remove headlines older than a cutoff date for a source
   *
   * @param {string} sourceId - Feed source identifier
   * @param {Date} cutoff - Remove headlines published before this date
   * @param {string} username - User identifier
   * @returns {Promise<number>} Number of headlines pruned
   */
  async pruneOlderThan(sourceId, cutoff, username) {
    throw new Error('Not implemented');
  }
}

export default IHeadlineStore;
