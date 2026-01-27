/**
 * YamlWeatherDatastore
 *
 * Simple YAML-based datastore for household weather data.
 * Weather data is shared at household level (not user-specific).
 *
 * @module adapters/persistence/yaml/YamlWeatherDatastore
 */

import path from 'path';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';

export class YamlWeatherDatastore {
  #dataRoot;
  #householdId;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.dataRoot - Base data directory
   * @param {string} [config.householdId='default'] - Household ID
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ dataRoot, householdId = 'default', logger = console }) {
    if (!dataRoot) {
      throw new Error('YamlWeatherDatastore requires dataRoot');
    }

    this.#dataRoot = dataRoot;
    this.#householdId = householdId;
    this.#logger = logger;
  }

  /**
   * Get the file path for weather data
   * @private
   */
  #getFilePath() {
    return path.join(this.#dataRoot, 'households', this.#householdId, 'shared', 'weather');
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
