/**
 * YamlHomeDashboardConfigRepository
 *
 * YAML-backed implementation of IHomeDashboardConfigRepository.
 * Loads the household home-dashboard config from
 * data/household[-{id}]/home/dashboard.yml via DataService.
 *
 * Read through `dataService.household.read()`, NOT the household app-config
 * union, so this file is deliberately absent from HOUSEHOLD_APP_CONFIGS. The
 * file does not exist in any household today — the dashboard runs on defaults
 * either way — so moving the literal is behaviour-neutral and just keeps this
 * reader off the `config/` directory a later phase deletes.
 *
 * @module adapters/persistence/yaml/YamlHomeDashboardConfigRepository
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CONFIG_PATH = 'home/dashboard';   // was 'config/home-dashboard'

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
