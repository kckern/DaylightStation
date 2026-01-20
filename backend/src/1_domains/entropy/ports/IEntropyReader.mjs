/**
 * IEntropyReader Port Interface
 *
 * Defines the contract for reading timestamps and counts from data sources.
 * Implementations should be lightweight - only reading what's needed for
 * entropy calculations, not full data extraction.
 *
 * @module entropy/ports
 */

/**
 * Interface for entropy data readers
 * @interface
 */
export class IEntropyReader {
  /**
   * Get the most recent timestamp from a data source
   *
   * @param {string} username - User identifier
   * @param {string} dataPath - Path to data file (relative to user lifelog)
   * @param {Object} [options] - Additional options
   * @param {string} [options.dateField='date'] - Field name containing date
   * @param {Object} [options.filter] - Filter criteria { field, operator, value }
   * @param {string} [options.listProperty] - Nested property containing list
   * @param {string} [options.checkField] - Field that must exist for valid entry
   * @returns {Promise<{ timestamp: number, date: string, data: any } | null>}
   */
  async getLastUpdated(username, dataPath, options = {}) {
    throw new Error('IEntropyReader.getLastUpdated must be implemented');
  }

  /**
   * Get count from a data source
   *
   * @param {string} username - User identifier
   * @param {string} dataPath - Path to data file (relative to user lifelog)
   * @param {Object} [options] - Additional options
   * @param {string} [options.countField] - Field containing count value
   * @param {string} [options.listProperty] - Nested property containing list
   * @returns {Promise<{ count: number, lastUpdated: string | null }>}
   */
  async getCount(username, dataPath, options = {}) {
    throw new Error('IEntropyReader.getCount must be implemented');
  }
}

export default IEntropyReader;
