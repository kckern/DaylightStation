/**
 * IFoodLogDatastore Port (INutriLogDatastore)
 *
 * Port interface for NutriLog persistence.
 * Implementations handle storage details (YAML, database, etc.)
 */

export class IFoodLogDatastore {
  /**
   * Save a NutriLog entity
   * @param {NutriLog} nutriLog - NutriLog entity
   * @returns {Promise<NutriLog>}
   */
  async save(nutriLog) {
    throw new Error('IFoodLogDatastore.save must be implemented');
  }

  /**
   * Find a NutriLog by ID
   * @param {string} userId - User identifier
   * @param {string} id - Log ID
   * @returns {Promise<NutriLog|null>}
   */
  async findById(userId, id) {
    throw new Error('IFoodLogDatastore.findById must be implemented');
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
    throw new Error('IFoodLogDatastore.findAll must be implemented');
  }

  /**
   * Find logs by date
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDate(userId, date) {
    throw new Error('IFoodLogDatastore.findByDate must be implemented');
  }

  /**
   * Find logs by date range
   * @param {string} userId - User identifier
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    throw new Error('IFoodLogDatastore.findByDateRange must be implemented');
  }

  /**
   * Find pending logs
   * @param {string} userId - User identifier
   * @returns {Promise<NutriLog[]>}
   */
  async findPending(userId) {
    throw new Error('IFoodLogDatastore.findPending must be implemented');
  }

  /**
   * Find accepted logs
   * @param {string} userId - User identifier
   * @returns {Promise<NutriLog[]>}
   */
  async findAccepted(userId) {
    throw new Error('IFoodLogDatastore.findAccepted must be implemented');
  }

  /**
   * Delete a NutriLog (soft delete by changing status)
   * @param {string} userId - User identifier
   * @param {string} id - Log ID
   * @returns {Promise<NutriLog>}
   */
  async delete(userId, id) {
    throw new Error('IFoodLogDatastore.delete must be implemented');
  }

  /**
   * Count logs for a user
   * @param {string} userId - User identifier
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @returns {Promise<number>}
   */
  async count(userId, options = {}) {
    throw new Error('IFoodLogDatastore.count must be implemented');
  }

  /**
   * Get daily nutrition summary
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object>}
   */
  async getDailySummary(userId, date) {
    throw new Error('IFoodLogDatastore.getDailySummary must be implemented');
  }
}

/**
 * Check if an object implements IFoodLogDatastore
 * @param {any} obj
 * @returns {boolean}
 */
export function isFoodLogDatastore(obj) {
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
 * Assert that an object implements IFoodLogDatastore
 * @param {any} obj
 * @returns {IFoodLogDatastore}
 * @throws {Error} if obj does not implement IFoodLogDatastore
 */
export function assertFoodLogDatastore(obj) {
  if (!isFoodLogDatastore(obj)) {
    throw new Error('Object does not implement IFoodLogDatastore');
  }
  return obj;
}

export default IFoodLogDatastore;
