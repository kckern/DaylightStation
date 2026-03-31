/**
 * YamlWeatherDatastore
 *
 * Simple YAML-based datastore for household weather data.
 * Weather data is shared at household level (not user-specific).
 * Path: household[-{id}]/common/weather
 *
 * Uses DataService for filesystem abstraction - adapter does not
 * interact with filesystem directly.
 *
 * @module adapters/persistence/yaml/YamlWeatherDatastore
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

const WEATHER_PATH = 'common/weather';
const HISTORY_PREFIX = 'history/weather';

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
   * Save weather data (current + daily history snapshot)
   * @param {Object} data - Weather data to save
   */
  async save(data) {
    this.#logger.debug?.('weather.store.save', { householdId: this.#householdId, keys: Object.keys(data) });
    const result = this.#dataService.household.write(WEATHER_PATH, data, this.#householdId);
    if (!result) {
      this.#logger.error?.('weather.store.save.failed', { householdId: this.#householdId });
    }

    // Save daily history snapshot (one per day, overwritten throughout the day)
    if (data.current) {
      const dateStr = data.current.time?.slice(0, 10);
      if (dateStr) {
        const historyPath = `${HISTORY_PREFIX}/${dateStr}`;
        const existing = this.#dataService.household.read(historyPath, this.#householdId);
        const snapshot = {
          date: dateStr,
          temp: data.current.temp,
          feel: data.current.feel,
          code: data.current.code,
          cloud: data.current.cloud,
          precip: data.current.precip,
          aqi: data.current.aqi,
          updatedAt: data.now,
          // Keep high/low across all snapshots for the day
          high: Math.max(data.current.temp, existing?.high ?? -Infinity),
          low: Math.min(data.current.temp, existing?.low ?? Infinity),
        };
        this.#dataService.household.write(historyPath, snapshot, this.#householdId);
        this.#logger.debug?.('weather.store.history-saved', { date: dateStr, temp: snapshot.temp });
      }
    }

    return result;
  }

  /**
   * Load current weather data
   * @returns {Object|null} Weather data or null if not found
   */
  async load() {
    const data = this.#dataService.household.read(WEATHER_PATH, this.#householdId);
    if (!data) {
      this.#logger.debug?.('weather.store.load.notFound', { householdId: this.#householdId });
    }
    return data;
  }

  /**
   * Load weather history for a specific date
   * @param {string} date - YYYY-MM-DD
   * @returns {Object|null} Daily weather snapshot or null
   */
  async loadDate(date) {
    return this.#dataService.household.read(`${HISTORY_PREFIX}/${date}`, this.#householdId);
  }
}

export default YamlWeatherDatastore;
