/**
 * YamlHomeDashboardConfigRepository
 *
 * YAML-backed implementation of IHomeDashboardConfigRepository.
 * Loads the household home-dashboard config from
 * data/household[-{id}]/config/home-dashboard.yml via DataService.
 *
 * @module adapters/persistence/yaml/YamlHomeDashboardConfigRepository
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CONFIG_PATH = 'config/home-dashboard';

export class YamlHomeDashboardConfigRepository {
  #dataService;
  #householdId;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.configService] - ConfigService for default household
   * @param {string} [config.householdId] - Household ID override
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ dataService, configService, householdId, logger = console } = {}) {
    if (!dataService) {
      throw new InfrastructureError('YamlHomeDashboardConfigRepository requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#householdId = householdId || configService?.getDefaultHouseholdId?.() || 'default';
    this.#logger = logger;
  }

  /**
   * Load the home-dashboard config.
   * @returns {Promise<{ summary: Object, rooms: Array }>}
   */
  async load() {
    const raw = this.#dataService.household.read(CONFIG_PATH, this.#householdId);
    if (!raw) {
      this.#logger.warn?.('home.dashboard.config.missing', { householdId: this.#householdId });
      return { summary: {}, rooms: [] };
    }
    return {
      summary: raw.summary || {},
      rooms:   Array.isArray(raw.rooms) ? raw.rooms : [],
    };
  }
}

export default YamlHomeDashboardConfigRepository;
