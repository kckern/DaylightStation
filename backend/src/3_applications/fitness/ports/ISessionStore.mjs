/**
 * ISessionStore - Port interface for session persistence
 */

export const ISessionStore = {
  /**
   * Save a session
   * @param {Object} session - Session to save
   * @returns {Promise<void>}
   */
  async save(session) {},

  /**
   * Find a session by ID
   * @param {string} sessionId - Session ID (YYYYMMDDHHmmss format)
   * @param {string} householdId - Household ID
   * @returns {Promise<Object|null>}
   */
  async findById(sessionId, householdId) {},

  /**
   * Find sessions by date
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findByDate(date, householdId) {},

  /**
   * List all dates that have sessions
   * @param {string} householdId - Household ID
   * @returns {Promise<string[]>} Array of YYYY-MM-DD date strings
   */
  async listDates(householdId) {},

  /**
   * Find sessions in date range
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findInRange(startDate, endDate, householdId) {},

  /**
   * Find active (not ended) sessions
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async findActive(householdId) {},

  /**
   * Delete a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   * @returns {Promise<void>}
   */
  async delete(sessionId, householdId) {},

  /**
   * Get storage paths for a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   * @returns {{sessionDate: string, sessionsDir: string, screenshotsDir: string}}
   */
  getStoragePaths(sessionId, householdId) {}
};

export default ISessionStore;
