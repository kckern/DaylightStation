/**
 * IHarvester Port Interface
 *
 * Defines the contract for scheduled batch data harvesters.
 * Harvesters fetch historical data from external APIs and persist to YAML.
 *
 * @module harvester/ports
 */

/**
 * Harvester categories for grouping
 * @readonly
 * @enum {string}
 */
export const HarvesterCategory = {
  FITNESS: 'fitness',
  SOCIAL: 'social',
  PRODUCTIVITY: 'productivity',
  COMMUNICATION: 'communication',
  FINANCE: 'finance',
  OTHER: 'other',
};

/**
 * Interface for scheduled batch data harvesters
 * @interface
 */
export class IHarvester {
  /**
   * Service identifier (e.g., 'garmin', 'lastfm')
   * @returns {string}
   */
  get serviceId() {
    throw new Error('IHarvester.serviceId must be implemented');
  }

  /**
   * Category for grouping (e.g., 'fitness', 'social', 'productivity')
   * @returns {string}
   */
  get category() {
    throw new Error('IHarvester.category must be implemented');
  }

  /**
   * Fetch data from external API and save to lifelog YAML.
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {boolean} [options.full] - Full sync vs incremental
   * @param {boolean} [options.backfill] - Write directly to archives
   * @returns {Promise<HarvestResult>}
   */
  async harvest(username, options = {}) {
    throw new Error('IHarvester.harvest must be implemented');
  }

  /**
   * Get circuit breaker and harvest status.
   * @returns {HarvesterStatus}
   */
  getStatus() {
    throw new Error('IHarvester.getStatus must be implemented');
  }
}

/**
 * @typedef {Object} HarvestResult
 * @property {number} count - Number of items harvested
 * @property {string} status - 'success' | 'skipped' | 'error'
 * @property {string} [reason] - Reason if skipped
 * @property {number} [remainingMins] - Minutes until cooldown expires (if skipped)
 */

/**
 * @typedef {Object} HarvesterStatus
 * @property {string} state - 'closed' | 'open' | 'half-open'
 * @property {number} failures - Consecutive failure count
 * @property {number|null} lastFailure - Timestamp of last failure
 * @property {number|null} cooldownUntil - Timestamp when cooldown expires
 */

export default IHarvester;
