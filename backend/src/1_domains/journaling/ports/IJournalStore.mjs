/**
 * IJournalStore Port
 *
 * Port interface for JournalEntry persistence.
 * Implementations handle storage details (YAML, database, etc.)
 */

export class IJournalStore {
  /**
   * Save a journal entry
   * @param {JournalEntry} entry - Journal entry entity
   * @returns {Promise<void>}
   */
  async save(entry) {
    throw new Error('IJournalStore.save must be implemented');
  }

  /**
   * Find journal entry by ID
   * @param {string} id - Entry identifier
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    throw new Error('IJournalStore.findById must be implemented');
  }

  /**
   * Find journal entry by user ID and date
   * @param {string} userId - User identifier
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Object|null>}
   */
  async findByUserAndDate(userId, date) {
    throw new Error('IJournalStore.findByUserAndDate must be implemented');
  }

  /**
   * Find journal entries for user in date range
   * @param {string} userId - User identifier
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object[]>}
   */
  async findByUserInRange(userId, startDate, endDate) {
    throw new Error('IJournalStore.findByUserInRange must be implemented');
  }

  /**
   * Find journal entries by user and tag
   * @param {string} userId - User identifier
   * @param {string} tag - Tag to filter by
   * @returns {Promise<Object[]>}
   */
  async findByUserAndTag(userId, tag) {
    throw new Error('IJournalStore.findByUserAndTag must be implemented');
  }

  /**
   * List all dates with journal entries for a user
   * @param {string} userId - User identifier
   * @returns {Promise<string[]>} - Array of YYYY-MM-DD date strings
   */
  async listDates(userId) {
    throw new Error('IJournalStore.listDates must be implemented');
  }

  /**
   * Delete a journal entry
   * @param {string} id - Entry identifier
   * @returns {Promise<void>}
   */
  async delete(id) {
    throw new Error('IJournalStore.delete must be implemented');
  }
}

export default IJournalStore;
