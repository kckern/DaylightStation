/**
 * IFoodLogStore Port (INutriLogStore)
 *
 * Port interface for NutriLog persistence.
 * Implementations handle storage details (YAML, database, etc.)
 */

export class IFoodLogStore {
  /**
   * Save a NutriLog entity
   * @param {NutriLog} nutriLog - NutriLog entity
   * @returns {Promise<NutriLog>}
   */
  async save(nutriLog) {
    throw new Error('IFoodLogStore.save must be implemented');
  }

  /**
   * Find a NutriLog by ID
   * @param {string} userId - User identifier
   * @param {string} id - Log ID
   * @returns {Promise<NutriLog|null>}
   */
  async findById(userId, id) {
    throw new Error('IFoodLogStore.findById must be implemented');
  }

  /**
   * Find all NutriLogs for a user
   * @param {string} userId - User identifier
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.date] - Filter by date (YYYY-MM-DD)
   * @param {string} [options.startDate] - Filter by start date
   * @param {string} [options.endDate] - Filter by end date
   * @returns {Promise<NutriLog[]>}
   */
  async findAll(userId, options = {}) {
    throw new Error('IFoodLogStore.findAll must be implemented');
  }

  /**
   * Find logs by date
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDate(userId, date) {
    throw new Error('IFoodLogStore.findByDate must be implemented');
  }

  /**
   * Find logs by date range
   * @param {string} userId - User identifier
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    throw new Error('IFoodLogStore.findByDateRange must be implemented');
  }

  /**
   * Find pending logs
   * @param {string} userId - User identifier
   * @returns {Promise<NutriLog[]>}
   */
  async findPending(userId) {
    throw new Error('IFoodLogStore.findPending must be implemented');
  }

  /**
   * Find accepted logs
   * @param {string} userId - User identifier
   * @returns {Promise<NutriLog[]>}
   */
  async findAccepted(userId) {
    throw new Error('IFoodLogStore.findAccepted must be implemented');
  }

  /**
   * Delete a NutriLog (soft delete by changing status)
   * @param {string} userId - User identifier
   * @param {string} id - Log ID
   * @returns {Promise<NutriLog>}
   */
  async delete(userId, id) {
    throw new Error('IFoodLogStore.delete must be implemented');
  }

  /**
   * Count logs for a user
   * @param {string} userId - User identifier
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @returns {Promise<number>}
   */
  async count(userId, options = {}) {
    throw new Error('IFoodLogStore.count must be implemented');
  }

  /**
   * Get daily nutrition summary
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object>}
   */
  async getDailySummary(userId, date) {
    throw new Error('IFoodLogStore.getDailySummary must be implemented');
  }
}

/**
 * Check if an object implements IFoodLogStore
 * @param {any} obj
 * @returns {boolean}
 */
export function isFoodLogStore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return (
    typeof obj.save === 'function' &&
    typeof obj.findById === 'function' &&
    typeof obj.findAll === 'function' &&
    typeof obj.findByDate === 'function' &&
    typeof obj.findByDateRange === 'function' &&
    typeof obj.findPending === 'function' &&
    typeof obj.findAccepted === 'function' &&
    typeof obj.delete === 'function'
  );
}

/**
 * Assert that an object implements IFoodLogStore
 * @param {any} obj
 * @returns {IFoodLogStore}
 * @throws {Error} if obj does not implement IFoodLogStore
 */
export function assertFoodLogStore(obj) {
  if (!isFoodLogStore(obj)) {
    throw new Error('Object does not implement IFoodLogStore');
  }
  return obj;
}

export default IFoodLogStore;
