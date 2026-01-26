/**
 * IHealthDataStore Port
 *
 * Interface for health data persistence.
 *
 * @module domains/health/ports
 */

/**
 * @interface IHealthDataStore
 */
export class IHealthDataStore {
  /**
   * Load weight data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Weight data keyed by date
   */
  async loadWeightData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Load Strava workout data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Strava data keyed by date
   */
  async loadStravaData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Load FitnessSyncer data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Fitness data keyed by date
   */
  async loadFitnessData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Load nutrition summary data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Nutrition data keyed by date
   */
  async loadNutritionData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Load aggregated health data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Health data keyed by date
   */
  async loadHealthData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Save aggregated health data for a user
   * @param {string} userId
   * @param {Object} healthData - Health data keyed by date
   * @returns {Promise<void>}
   */
  async saveHealthData(userId, healthData) {
    throw new Error('Not implemented');
  }

  /**
   * Load health coaching messages for a user
   * @param {string} userId
   * @returns {Promise<Object>} Coaching data keyed by date
   */
  async loadCoachingData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Save health coaching data for a user
   * @param {string} userId
   * @param {Object} coachingData - Coaching data keyed by date
   * @returns {Promise<void>}
   */
  async saveCoachingData(userId, coachingData) {
    throw new Error('Not implemented');
  }
}

export default IHealthDataStore;
