/**
 * ICostSource - Port interface for cost data sources
 * @module applications/cost/ports/ICostSource
 *
 * Defines the contract for adapters that provide cost data from external services.
 * Each source represents a different cost provider (e.g., OpenAI, Telnyx, HomeAssistant).
 *
 * @example
 * class OpenAICostSource extends ICostSource {
 *   getSourceId() { return 'openai'; }
 *   getSupportedCategories() { return ['ai/openai/gpt-4o', 'ai/openai/gpt-4o-mini']; }
 *   async fetchCosts(since) { ... }
 *   onCost(callback) { ... }
 * }
 */

/**
 * ICostSource interface
 * Abstract base class for cost data source adapters
 *
 * @class ICostSource
 */
export class ICostSource {
  /**
   * Get the unique identifier for this cost source
   *
   * @returns {string} Source identifier (e.g., 'openai', 'telnyx', 'home-assistant')
   * @throws {Error} Must be implemented by concrete class
   */
  getSourceId() {
    throw new Error('ICostSource.getSourceId must be implemented');
  }

  /**
   * Get the list of cost categories this source supports
   *
   * Returns an array of category strings that this source can provide costs for.
   * Categories follow the hierarchical format (e.g., 'ai/openai/gpt-4o').
   *
   * @returns {string[]} Array of supported category strings
   * @throws {Error} Must be implemented by concrete class
   */
  getSupportedCategories() {
    throw new Error('ICostSource.getSupportedCategories must be implemented');
  }

  /**
   * Fetch costs from the external source
   *
   * Retrieves cost entries from the source since the given timestamp.
   * Returns an array of CostEntry-compatible objects.
   *
   * @param {Date} [since] - Only fetch costs after this timestamp (optional, defaults to all available)
   * @returns {Promise<Object[]>} Array of cost entry data objects
   * @throws {Error} Must be implemented by concrete class
   */
  async fetchCosts(since) {
    throw new Error('ICostSource.fetchCosts must be implemented');
  }

  /**
   * Register a callback for real-time cost events
   *
   * Called when a new cost event occurs (for sources that support real-time events).
   * The callback receives cost entry data that can be converted to a CostEntry.
   *
   * @param {Function} callback - Callback function receiving cost entry data
   * @returns {Function|void} Optional unsubscribe function
   * @throws {Error} Must be implemented by concrete class
   */
  onCost(callback) {
    throw new Error('ICostSource.onCost must be implemented');
  }
}

export default ICostSource;
