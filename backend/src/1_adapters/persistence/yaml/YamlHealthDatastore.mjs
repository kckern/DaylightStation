/**
 * YamlHealthDatastore - YAML-based health data persistence
 *
 * Implements IHealthDataDatastore port for health metrics storage.
 * Data stored at: users/{username}/lifelog/
 *   - weight.yml
 *   - strava.yml
 *   - fitness.yml
 *   - nutrition/nutriday.yml
 *   - health.yml
 *   - health_coaching.yml
 *
 * @module adapters/persistence/yaml
 */

import { IHealthDataDatastore } from '#apps/health/ports/IHealthDataDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlHealthDatastore extends IHealthDataDatastore {
  #dataService;
  #userResolver;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService instance for YAML I/O
   * @param {Object} [config.userResolver] - UserResolver for ID to username mapping
   * @param {Object} [config.configService] - ConfigService for default user lookup
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    super();
    if (!config.dataService) {
      throw new InfrastructureError('YamlHealthDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = config.dataService;
    this.#userResolver = config.userResolver;
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get username from userId (resolve if needed)
   * @private
   */
  #resolveUsername(userId) {
    if (this.#userResolver?.resolveUser) {
      // Strip canonical 'c' prefix from chat IDs if present
      const cleanId = String(userId).replace(/^c/, '');
      return this.#userResolver.resolveUser('telegram', cleanId) || userId;
    }
    return userId;
  }

  /**
   * Get default username from config
   * @private
   */
  #getDefaultUsername() {
    return this.#configService?.getHeadOfHousehold?.() ||
           this.#configService?.getDefaultUsername?.() ||
           'default';
  }

  /**
   * Load user lifelog file
   * @private
   */
  #loadUserFile(userId, path) {
    const username = userId ? this.#resolveUsername(userId) : this.#getDefaultUsername();
    const data = this.#dataService.user.read?.(path, username);
    return data || {};
  }

  /**
   * Save user lifelog file
   * @private
   */
  #saveUserFile(userId, path, data) {
    const username = userId ? this.#resolveUsername(userId) : this.#getDefaultUsername();
    this.#dataService.user.write?.(path, data, username);
  }

  // ===========================================================================
  // IHealthDataStore Implementation
  // ===========================================================================

  /**
   * Load weight data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Weight data keyed by date
   */
  async loadWeightData(userId) {
    this.#logger.debug?.('health.store.loadWeight', { userId });
    return this.#loadUserFile(userId, 'weight');
  }

  /**
   * Load workout/activity data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Activity data keyed by date
   */
  async loadActivityData(userId) {
    this.#logger.debug?.('health.store.loadActivity', { userId });
    return this.#loadUserFile(userId, 'strava');
  }

  /**
   * Load FitnessSyncer data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Fitness data keyed by date
   */
  async loadFitnessData(userId) {
    this.#logger.debug?.('health.store.loadFitness', { userId });
    return this.#loadUserFile(userId, 'fitness');
  }

  /**
   * Load nutrition summary data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Nutrition data keyed by date
   */
  async loadNutritionData(userId) {
    this.#logger.debug?.('health.store.loadNutrition', { userId });
    return this.#loadUserFile(userId, 'nutrition/nutriday');
  }

  /**
   * Load aggregated health data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Health data keyed by date
   */
  async loadHealthData(userId) {
    this.#logger.debug?.('health.store.loadHealth', { userId });
    return this.#loadUserFile(userId, 'health');
  }

  /**
   * Save aggregated health data for a user
   * @param {string} userId
   * @param {Object} healthData - Health data keyed by date
   * @returns {Promise<void>}
   */
  async saveHealthData(userId, healthData) {
    this.#logger.debug?.('health.store.saveHealth', { userId, dates: Object.keys(healthData).length });
    this.#saveUserFile(userId, 'health', healthData);
  }

  /**
   * Load health coaching messages for a user
   * @param {string} userId
   * @returns {Promise<Object>} Coaching data keyed by date
   */
  async loadCoachingData(userId) {
    this.#logger.debug?.('health.store.loadCoaching', { userId });
    return this.#loadUserFile(userId, 'health_coaching');
  }

  /**
   * Save health coaching data for a user
   * @param {string} userId
   * @param {Object} coachingData - Coaching data keyed by date
   * @returns {Promise<void>}
   */
  async saveCoachingData(userId, coachingData) {
    this.#logger.debug?.('health.store.saveCoaching', { userId });
    this.#saveUserFile(userId, 'health_coaching', coachingData);
  }

  // ===========================================================================
  // Additional Convenience Methods
  // ===========================================================================

  /**
   * Get weight for a specific date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Object|null>}
   */
  async getWeightForDate(userId, date) {
    const data = await this.loadWeightData(userId);
    return data[date] || null;
  }

  /**
   * Get all workouts for a specific date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Object>} { activity: [], fitness: [] }
   */
  async getWorkoutsForDate(userId, date) {
    const [activity, fitness] = await Promise.all([
      this.loadActivityData(userId),
      this.loadFitnessData(userId)
    ]);

    return {
      activity: activity[date] || [],
      fitness: fitness[date]?.activities || []
    };
  }

  /**
   * Get aggregated health for a date range
   * @param {string} userId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Object>} Health data keyed by date
   */
  async getHealthForRange(userId, startDate, endDate) {
    const allData = await this.loadHealthData(userId);
    const result = {};

    for (const [date, data] of Object.entries(allData)) {
      if (date >= startDate && date <= endDate) {
        result[date] = data;
      }
    }

    return result;
  }
}

export default YamlHealthDatastore;
