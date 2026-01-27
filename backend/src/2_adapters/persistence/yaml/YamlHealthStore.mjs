/**
 * YamlHealthStore - YAML-based health data persistence
 *
 * Implements IHealthDataStore port for health metrics storage.
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

import { IHealthDataDatastore } from '../../../3_applications/health/ports/IHealthDataDatastore.mjs';

export class YamlHealthStore extends IHealthDataDatastore {
  #userDataService;
  #userResolver;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService instance for YAML I/O
   * @param {Object} [config.userResolver] - UserResolver for ID to username mapping
   * @param {Object} [config.configService] - ConfigService for default user lookup
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    super();
    if (!config.userDataService) {
      throw new Error('YamlHealthStore requires userDataService');
    }
    this.#userDataService = config.userDataService;
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
    if (this.#userResolver?.resolveUsername) {
      return this.#userResolver.resolveUsername(userId) || userId;
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
    const data = this.#userDataService.readUserData?.(username, path);
    return data || {};
  }

  /**
   * Save user lifelog file
   * @private
   */
  #saveUserFile(userId, path, data) {
    const username = userId ? this.#resolveUsername(userId) : this.#getDefaultUsername();
    this.#userDataService.writeUserData?.(username, path, data);
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
   * Load Strava workout data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Strava data keyed by date
   */
  async loadStravaData(userId) {
    this.#logger.debug?.('health.store.loadStrava', { userId });
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
   * @returns {Promise<Object>} { strava: [], fitness: [] }
   */
  async getWorkoutsForDate(userId, date) {
    const [strava, fitness] = await Promise.all([
      this.loadStravaData(userId),
      this.loadFitnessData(userId)
    ]);

    return {
      strava: strava[date] || [],
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

export default YamlHealthStore;
