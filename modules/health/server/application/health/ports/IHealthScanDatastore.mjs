/**
 * IHealthScanDatastore Port (F-006)
 *
 * Interface for persistence of body-composition scan records (DEXA / InBody /
 * consumer-BIA). Implementations own the physical layout and encoding.
 *
 * @module applications/health/ports
 */

/**
 * @interface IHealthScanDatastore
 */
export class IHealthScanDatastore {
  /**
   * List all scans for a user, sorted by date ascending.
   * @param {string} userId
   * @returns {Promise<import('#domains/health/entities/HealthScan.mjs').HealthScan[]>}
   */
  async listScans(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Get the most recent scan for a user (highest ISO date).
   * @param {string} userId
   * @returns {Promise<import('#domains/health/entities/HealthScan.mjs').HealthScan|null>}
   */
  async getLatestScan(userId) {
    throw new Error('Not implemented');
  }

  /**
   * Persist a scan under its semantic user/date/source identity.
   * @param {string} userId
   * @param {import('#domains/health/entities/HealthScan.mjs').HealthScan} scan
   * @returns {Promise<void>}
   */
  async saveScan(userId, scan) {
    throw new Error('Not implemented');
  }

  /**
   * Delete every scan record for the given date.
   * Idempotent — no error if no files match.
   * @param {string} userId
   * @param {string} date YYYY-MM-DD
   * @returns {Promise<void>}
   */
  async deleteScan(userId, date) {
    throw new Error('Not implemented');
  }
}

export default IHealthScanDatastore;
