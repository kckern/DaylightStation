/**
 * INutriListDatastore Port
 *
 * Port interface for denormalized NutriList persistence.
 * NutriList stores individual food items for reporting/analytics.
 */

export class INutriListDatastore {
  /**
   * Sync nutrilist from a NutriLog (updates denormalized data)
   * @param {NutriLog} nutriLog - NutriLog entity
   * @returns {Promise<void>}
   */
  async syncFromLog(nutriLog) {
    throw new Error('INutriListDatastore.syncFromLog must be implemented');
  }

  /**
   * Save multiple items at once
   * @param {Object[]} items - Items to save
   * @returns {Promise<void>}
   */
  async saveMany(items) {
    throw new Error('INutriListDatastore.saveMany must be implemented');
  }

  /**
   * Find all items for a user
   * @param {string} userId - User identifier
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.color] - Filter by noom color
   * @returns {Promise<Object[]>}
   */
  async findAll(userId, options = {}) {
    throw new Error('INutriListDatastore.findAll must be implemented');
  }

  /**
   * Find items by log ID
   * @param {string} userId - User identifier
   * @param {string} logId - Log ID
   * @returns {Promise<Object[]>}
   */
  async findByLogId(userId, logId) {
    throw new Error('INutriListDatastore.findByLogId must be implemented');
  }

  /**
   * Find a single item by UUID
   * @param {string} userId - User identifier
   * @param {string} uuid - Item UUID
   * @returns {Promise<Object|null>}
   */
  async findByUuid(userId, uuid) {
    throw new Error('INutriListDatastore.findByUuid must be implemented');
  }

  /**
   * Update a single item
   * @param {string} userId - User identifier
   * @param {string} itemId - Item UUID or ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>}
   */
  async update(userId, itemId, updates) {
    throw new Error('INutriListDatastore.update must be implemented');
  }

  /**
   * Find items by date
   * @param {string} userId - User identifier
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object[]>}
   */
  async findByDate(userId, date) {
    throw new Error('INutriListDatastore.findByDate must be implemented');
  }

  /**
   * Find items by date range
   * @param {string} userId - User identifier
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    throw new Error('INutriListDatastore.findByDateRange must be implemented');
  }

  /**
   * Remove all items for a log
   * @param {string} userId - User identifier
   * @param {string} logId - Log ID
   * @returns {Promise<number>}
   */
  async removeByLogId(userId, logId) {
    throw new Error('INutriListDatastore.removeByLogId must be implemented');
  }

  /**
   * Update portion by applying a multiplier
   * @param {string} userId - User identifier
   * @param {string} uuid - Item UUID
   * @param {number} factor - Multiplier (e.g., 0.5 for half)
   * @returns {Promise<boolean>}
   */
  async updatePortion(userId, uuid, factor) {
    throw new Error('INutriListDatastore.updatePortion must be implemented');
  }

  /**
   * Delete an item by UUID
   * @param {string} userId - User identifier
   * @param {string} uuid - Item UUID
   * @returns {Promise<boolean>}
   */
  async deleteById(userId, uuid) {
    throw new Error('INutriListDatastore.deleteById must be implemented');
  }

  /**
   * Clear all items for a user
   * @param {string} userId - User identifier
   * @returns {Promise<void>}
   */
  async clear(userId) {
    throw new Error('INutriListDatastore.clear must be implemented');
  }

  /**
   * Get total grams by color
   * @param {string} userId - User identifier
   * @returns {Promise<Object>}
   */
  async getGramsByColor(userId) {
    throw new Error('INutriListDatastore.getGramsByColor must be implemented');
  }

  /**
   * Get item count by color
   * @param {string} userId - User identifier
   * @returns {Promise<Object>}
   */
  async getCountByColor(userId) {
    throw new Error('INutriListDatastore.getCountByColor must be implemented');
  }

  /**
   * Sync nutriday summaries
   * @param {string} userId - User identifier
   * @param {string[]} [datesToSync] - Specific dates to sync
   * @returns {Promise<void>}
   */
  async syncNutriday(userId, datesToSync = null) {
    throw new Error('INutriListDatastore.syncNutriday must be implemented');
  }

  /**
   * Archive old items to cold storage
   * @param {string} userId - User identifier
   * @param {number} [retentionDays=30] - Days to keep in hot storage
   * @returns {Promise<Object>}
   */
  async archiveOldItems(userId, retentionDays = 30) {
    throw new Error('INutriListDatastore.archiveOldItems must be implemented');
  }
}

/**
 * Check if an object implements INutriListDatastore
 * @param {any} obj
 * @returns {boolean}
 */
export function isNutriListDatastore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return (
    typeof obj.syncFromLog === 'function' &&
    typeof obj.findAll === 'function' &&
    typeof obj.findByLogId === 'function' &&
    typeof obj.findByDate === 'function' &&
    typeof obj.update === 'function' &&
    typeof obj.deleteById === 'function'
  );
}

export default INutriListDatastore;
