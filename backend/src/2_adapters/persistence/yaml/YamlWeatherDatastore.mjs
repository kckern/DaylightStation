/**
 * YamlWeatherDatastore
 *
 * Simple YAML-based datastore for household weather data.
 * Weather data is shared at household level (not user-specific).
 * Path: household[-{id}]/shared/weather
 *
 * Uses DataService for filesystem abstraction - adapter does not
 * interact with filesystem directly.
 *
 * @module adapters/persistence/yaml/YamlWeatherDatastore
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

const WEATHER_PATH = 'shared/weather';

export class YamlWeatherDatastore {
  #dataService;
  #householdId;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} config.configService - ConfigService for default household
   * @param {string} [config.householdId] - Household ID (defaults to default household)
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ dataService, configService, householdId, logger = console }) {
    if (!dataService) {
      throw new InfrastructureError('YamlWeatherDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }

    this.#dataService = dataService;
    this.#householdId = householdId || configService?.getDefaultHouseholdId() || 'default';
    this.#logger = logger;
  }

  /**
   * Save weather data
   * @param {Object} data - Weather data to save
   */
  async save(data) {
    this.#logger.debug?.('weather.store.save', { householdId: this.#householdId, keys: Object.keys(data) });
    const result = this.#dataService.household.write(WEATHER_PATH, data, this.#householdId);
    if (!result) {
      this.#logger.error?.('weather.store.save.failed', { householdId: this.#householdId });
    }
    return result;
  }

  /**
   * Load weather data
   * @returns {Object|null} Weather data or null if not found
   */
  async load() {
    const data = this.#dataService.household.read(WEATHER_PATH, this.#householdId);
    if (!data) {
      this.#logger.debug?.('weather.store.load.notFound', { householdId: this.#householdId });
    }
    return data;
  }
}

export default YamlWeatherDatastore;
