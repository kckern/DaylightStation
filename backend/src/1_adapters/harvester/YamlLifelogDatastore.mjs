/**
 * YamlLifelogDatastore
 *
 * Adapter for reading and writing lifelog YAML files.
 * Wraps io.mjs functions with a clean interface for harvester adapters.
 *
 * @module harvester/YamlLifelogDatastore
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * YAML-based lifelog persistence
 */
export class YamlLifelogDatastore {
  #io;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.io - IO functions { userLoadFile, userSaveFile }
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ io, logger = console }) {
    if (!io?.userLoadFile || !io?.userSaveFile) {
      throw new InfrastructureError('YamlLifelogDatastore requires io.userLoadFile and io.userSaveFile', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'io'
      });
    }

    this.#io = io;
    this.#logger = logger;
  }

  /**
   * Load lifelog data for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier (e.g., 'strava')
   * @returns {Promise<Object|Array|null>} Parsed YAML data or null if not found
   */
  async load(username, service) {
    try {
      const data = this.#io.userLoadFile(username, service);
      return data || null;
    } catch (error) {
      this.#logger.warn?.('lifelogStore.load.error', {
        username,
        service,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Save lifelog data for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier (e.g., 'strava')
   * @param {Object|Array} data - Data to save
   * @returns {Promise<void>}
   */
  async save(username, service, data) {
    try {
      this.#io.userSaveFile(username, service, data);

      this.#logger.debug?.('lifelogStore.save.success', {
        username,
        service,
        size: this.#estimateSize(data),
      });
    } catch (error) {
      this.#logger.error?.('lifelogStore.save.error', {
        username,
        service,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if lifelog data exists for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier
   * @returns {Promise<boolean>}
   */
  async exists(username, service) {
    const data = await this.load(username, service);
    return data !== null;
  }

  /**
   * Delete lifelog data for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier
   * @returns {Promise<void>}
   */
  async delete(username, service) {
    try {
      // Save empty/null to effectively delete
      this.#io.userSaveFile(username, service, null);

      this.#logger.info?.('lifelogStore.delete.success', {
        username,
        service,
      });
    } catch (error) {
      this.#logger.warn?.('lifelogStore.delete.error', {
        username,
        service,
        error: error.message,
      });
    }
  }

  /**
   * Estimate size of data for logging
   * @private
   */
  #estimateSize(data) {
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object') return Object.keys(data).length;
    return 1;
  }
}

export default YamlLifelogDatastore;
