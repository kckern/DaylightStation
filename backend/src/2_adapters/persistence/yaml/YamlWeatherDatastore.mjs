/**
 * YamlWeatherDatastore
 *
 * Simple YAML-based datastore for household weather data.
 * Weather data is shared at household level (not user-specific).
 * Path (via ConfigService.getHouseholdPath): household[-{id}]/shared/weather
 *
 * @module adapters/persistence/yaml/YamlWeatherDatastore
 */

import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlWeatherDatastore {
  #configService;
  #householdId;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService instance for path resolution
   * @param {string} [config.householdId] - Household ID (defaults to default household)
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ configService, householdId, logger = console }) {
    if (!configService) {
      throw new InfrastructureError('YamlWeatherDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService'
      });
    }

    this.#configService = configService;
    this.#householdId = householdId || configService.getDefaultHouseholdId();
    this.#logger = logger;
  }

  /**
   * Get the file path for weather data
   * @private
   */
  #getFilePath() {
    return this.#configService.getHouseholdPath('shared/weather', this.#householdId);
  }

  /**
   * Save weather data
   * @param {Object} data - Weather data to save
   */
  async save(data) {
    const filePath = this.#getFilePath();
    this.#logger.debug?.('weather.store.save', { filePath, keys: Object.keys(data) });
    await saveYaml(filePath, data);
  }

  /**
   * Load weather data
   * @returns {Object|null} Weather data or null if not found
   */
  async load() {
    const filePath = this.#getFilePath();
    try {
      return await loadYaml(filePath);
    } catch (error) {
      this.#logger.debug?.('weather.store.load.notFound', { filePath });
      return null;
    }
  }
}

export default YamlWeatherDatastore;
