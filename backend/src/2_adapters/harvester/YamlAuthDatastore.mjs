/**
 * YamlAuthDatastore
 *
 * Adapter for reading and writing auth credentials YAML files.
 * Used by harvesters that need to persist OAuth tokens.
 *
 * @module harvester/YamlAuthDatastore
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * YAML-based auth persistence
 */
export class YamlAuthDatastore {
  #io;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.io - IO functions { userLoadAuth, userSaveAuth }
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ io, logger = console }) {
    if (!io?.userSaveAuth) {
      throw new InfrastructureError('YamlAuthDatastore requires io.userSaveAuth', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'io'
      });
    }

    this.#io = io;
    this.#logger = logger;
  }

  /**
   * Load auth data for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier (e.g., 'strava')
   * @returns {Promise<Object|null>} Auth data or null if not found
   */
  async load(username, service) {
    try {
      // configService.getUserAuth handles the loading
      return null; // Let configService handle reads
    } catch (error) {
      this.#logger.warn?.('authStore.load.error', {
        username,
        service,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Save auth data for a service
   *
   * @param {string} username - Target user
   * @param {string} service - Service identifier (e.g., 'strava')
   * @param {Object} data - Auth data to save
   * @returns {Promise<void>}
   */
  async save(username, service, data) {
    try {
      this.#io.userSaveAuth(username, service, data);

      this.#logger.debug?.('authStore.save.success', {
        username,
        service,
      });
    } catch (error) {
      this.#logger.error?.('authStore.save.error', {
        username,
        service,
        error: error.message,
      });
      throw error;
    }
  }
}

export default YamlAuthDatastore;
