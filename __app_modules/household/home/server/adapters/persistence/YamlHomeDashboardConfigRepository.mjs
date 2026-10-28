/**
 * YamlHomeDashboardConfigRepository
 *
 * YAML-backed implementation of IHomeDashboardConfigRepository.
 * Loads the household home-dashboard config from
 * data/household[-{id}]/home/dashboard.yml via DataService.
 *
 * Read through `dataService.household.read()`, NOT the household app-config
 * union, so this file is deliberately absent from HOUSEHOLD_APP_CONFIGS.
 *
 * Sections: `summary` and `rooms` (the hand-curated room dashboard) and
 * `entities` (the entity policy for /home: which Home Assistant entities are
 * shown, their types and rooms, and which may be switched — validated by
 * EntityCatalogPolicy). Every section is optional; an absent file means
 * defaults throughout.
 *
 * @module adapters/persistence/yaml/YamlHomeDashboardConfigRepository
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IHomeDashboardConfigRepository } from "../../application/home-automation/ports/IHomeDashboardConfigRepository.mjs";

const CONFIG_PATH = 'home/dashboard';   // was 'config/home-dashboard'

export class YamlHomeDashboardConfigRepository extends IHomeDashboardConfigRepository {
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
    super();
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
   * @returns {Promise<{ summary: Object, rooms: Array, entities: Object }>}
   */
  async load() {
    const raw = this.#dataService.household.read(CONFIG_PATH, this.#householdId);
    if (!raw) {
      this.#logger.warn?.('home.dashboard.config.missing', { householdId: this.#householdId });
      return { summary: {}, rooms: [], entities: {} };
    }
    return {
      summary: raw.summary || {},
      rooms:   Array.isArray(raw.rooms) ? raw.rooms : [],
      // The entity catalog policy; EntityCatalogPolicy validates its shape.
      entities: raw.entities && typeof raw.entities === 'object' ? raw.entities : {},
    };
  }
}

export default YamlHomeDashboardConfigRepository;
