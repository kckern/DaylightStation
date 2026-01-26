/**
 * INutriCoachStore Port
 *
 * Port interface for coaching message history persistence.
 * Stores coaching messages and their context for each user.
 */

export class INutriCoachStore {
  /**
   * Save a coaching entry
   * @param {Object} entry
   * @param {string} entry.userId - User ID
   * @param {string} entry.date - Date (YYYY-MM-DD)
   * @param {string} entry.message - Coaching message
   * @param {boolean} [entry.isFirstOfDay] - Whether this is first coaching of the day
   * @param {Object} [entry.context] - Context data (calories, recentItems, etc.)
   * @returns {Promise<void>}
   */
  async save(entry) {
    throw new Error('INutriCoachStore.save must be implemented');
  }

  /**
   * Get coaching entries for a specific date
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object[]>}
   */
  async getByDate(userId, date) {
    throw new Error('INutriCoachStore.getByDate must be implemented');
  }

  /**
   * Get count of today's coaching messages
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<number>}
   */
  async getTodayCount(userId, date) {
    throw new Error('INutriCoachStore.getTodayCount must be implemented');
  }

  /**
   * Check if this would be the first coaching of the day
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<boolean>}
   */
  async isFirstOfDay(userId, date) {
    throw new Error('INutriCoachStore.isFirstOfDay must be implemented');
  }

  /**
   * Get recent coaching messages across all dates
   * @param {string} userId - User identifier
   * @param {number} [count=10] - Number of messages to retrieve
   * @returns {Promise<Object[]>}
   */
  async getRecent(userId, count = 10) {
    throw new Error('INutriCoachStore.getRecent must be implemented');
  }

  /**
   * Get coaching history for the last N days
   * @param {string} userId - User identifier
   * @param {number} [days=14] - Number of days to look back
   * @returns {Promise<Object>}
   */
  async getHistory(userId, days = 14) {
    throw new Error('INutriCoachStore.getHistory must be implemented');
  }

  /**
   * Get all coaching data for a user
   * @param {string} userId - User identifier
   * @returns {Promise<Object>}
   */
  async getAll(userId) {
    throw new Error('INutriCoachStore.getAll must be implemented');
  }

  /**
   * Clear all coaching data for a user
   * @param {string} userId - User identifier
   * @returns {Promise<void>}
   */
  async clear(userId) {
    throw new Error('INutriCoachStore.clear must be implemented');
  }
}

/**
 * Check if an object implements INutriCoachStore
 * @param {any} obj
 * @returns {boolean}
 */
export function isNutriCoachStore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return (
    typeof obj.save === 'function' &&
    typeof obj.getByDate === 'function' &&
    typeof obj.getRecent === 'function' &&
    typeof obj.getHistory === 'function'
  );
}

export default INutriCoachStore;
