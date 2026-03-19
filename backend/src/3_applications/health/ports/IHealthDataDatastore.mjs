/**
 * IHealthDataDatastore Port
 *
 * Interface for health data persistence.
 *
 * @module domains/health/ports
 */

/**
 * @interface IHealthDataDatastore
 */
export class IHealthDataDatastore {
  /**
   * Load weight data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Weight data keyed by date
   */
  async loadWeightData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Load workout/activity data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Activity data keyed by date
   */
  async loadActivityData(userId) {
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

  /**
   * Load reconciliation data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Reconciliation data keyed by date
   */
  async loadReconciliationData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Save reconciliation data for a user
   * @param {string} userId
   * @param {Object} data - Reconciliation data keyed by date
   * @returns {Promise<void>}
   */
  async saveReconciliationData(userId, data) {
    throw new Error('Not implemented');
  }

  /**
   * Load adjusted nutrition data for a user
   * @param {string} userId
   * @returns {Promise<Object>} Adjusted nutrition data keyed by date
   */
  async loadAdjustedNutritionData(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Save adjusted nutrition data for a user
   * @param {string} userId
   * @param {Object} data - Adjusted nutrition data keyed by date
   * @returns {Promise<void>}
   */
  async saveAdjustedNutritionData(userId, data) {
    throw new Error('Not implemented');
  }
}

export default IHealthDataDatastore;
