/**
 * YamlCurrentDatastore
 *
 * Adapter for reading and writing current state YAML files.
 * Used by harvesters to track transient state (inbox count, task snapshots, etc.)
 * that doesn't belong in historical lifelog.
 *
 * Path: users/{username}/current/{service}.yml
 *
 * @module harvester/YamlCurrentDatastore
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * YAML-based current state persistence
 */
export class YamlCurrentDatastore {
  #io;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.io - IO functions { userLoadFile, userSaveFileDirect }
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ io, logger = console }) {
    if (!io?.userLoadFile || !io?.userSaveFileDirect) {
      throw new InfrastructureError('YamlCurrentDatastore requires io.userLoadFile and io.userSaveFileDirect', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'io'
      });
    }

    this.#io = io;
    this.#logger = logger;
  }

  /**
   * Load current state for a service
   *
   * @param {string} username - Target user
   * @param {string} [service] - Service identifier (e.g., 'todoist', 'gmail')
   * @returns {Promise<Object|null>} Parsed YAML data or null if not found
   */
  async load(username, service = null) {
    try {
      const path = service ? `current/${service}` : 'current';
      const data = this.#io.userLoadFile(username, path);
      return data || null;
    } catch (error) {
      this.#logger.warn?.('currentStore.load.error', {
        username,
        service,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Save current state for a service
   *
   * Supports two signatures:
   * - save(username, service, data) - for Todoist/ClickUp style
   * - save(username, data) - for Gmail/GCal style (service inferred from harvester)
   *
   * @param {string} username - Target user
   * @param {string|Object} serviceOrData - Service identifier OR data object
   * @param {Object} [data] - Data to save (if service provided)
   * @returns {Promise<void>}
   */
  async save(username, serviceOrData, data = null) {
    try {
      let service, saveData;

      if (typeof serviceOrData === 'string') {
        // 3-arg form: save(username, service, data)
        service = serviceOrData;
        saveData = data;
      } else {
        // 2-arg form: save(username, data) - use 'default' as service
        // The harvester should ideally pass its own service name
        service = 'default';
        saveData = serviceOrData;
      }

      const path = `current/${service}`;
      this.#io.userSaveFileDirect(username, path, saveData);

      this.#logger.debug?.('currentStore.save.success', {
        username,
        service,
        size: this.#estimateSize(saveData),
      });
    } catch (error) {
      this.#logger.error?.('currentStore.save.error', {
        username,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if current state exists for a service
   *
   * @param {string} username - Target user
   * @param {string} [service] - Service identifier
   * @returns {Promise<boolean>}
   */
  async exists(username, service = null) {
    const data = await this.load(username, service);
    return data !== null;
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

export default YamlCurrentDatastore;
