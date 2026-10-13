/**
 * ISessionDatastore - Port interface for session persistence
 */

export class ISessionDatastore {
  /**
   * Save a session
   * @param {Object} session - Session to save
   * @returns {Promise<void>}
   */
  async save(session) {
    throw new Error('ISessionDatastore.save must be implemented');
  }

  /**
   * Find a session by ID
   * @param {string} sessionId - Session ID (YYYYMMDDHHmmss format)
   * @param {string} householdId - Household ID
   * @returns {Promise<Object|null>}
   */
  async findById(sessionId, householdId) {
    throw new Error('ISessionDatastore.findById must be implemented');
  }

  /**
   * Find sessions by date
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findByDate(date, householdId) {
    throw new Error('ISessionDatastore.findByDate must be implemented');
  }

  /**
   * List all dates that have sessions
   * @param {string} householdId - Household ID
   * @returns {Promise<string[]>} Array of YYYY-MM-DD date strings
   */
  async listDates(householdId) {
    throw new Error('ISessionDatastore.listDates must be implemented');
  }

  /**
   * Find sessions in date range
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findInRange(startDate, endDate, householdId) {
    throw new Error('ISessionDatastore.findInRange must be implemented');
  }

  /**
   * Find active (not ended) sessions
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findActive(householdId) {
    throw new Error('ISessionDatastore.findActive must be implemented');
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   * @returns {Promise<void>}
   */
  async delete(sessionId, householdId) {
    throw new Error('ISessionDatastore.delete must be implemented');
  }

  /**
   * Get storage paths for a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   * @returns {{sessionDate: string, sessionsDir: string, screenshotsDir: string}}
   */
  getStoragePaths(sessionId, householdId) {
    throw new Error('ISessionDatastore.getStoragePaths must be implemented');
  }
}

export default ISessionDatastore;
