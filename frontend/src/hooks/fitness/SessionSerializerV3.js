import moment from 'moment-timezone';

/**
 * Serialize session data to v3 YAML format.
 * @see docs/_wip/plans/2026-01-06-session-yaml-v3-schema-design.md
 */
export class SessionSerializerV3 {
  /**
   * Format unix ms timestamp to human-readable string.
   * @param {number} unixMs
   * @param {string} timezone
   * @returns {string} 'YYYY-MM-DD H:mm:ss' format
   */
  static formatTimestamp(unixMs, timezone) {
    const tz = timezone || 'UTC';
    return moment(unixMs).tz(tz).format('YYYY-MM-DD H:mm:ss');
  }

  /**
   * Extract date portion from session ID (YYYYMMDDHHmmss).
   * @param {string} sessionId
   * @returns {string} 'YYYY-MM-DD'
   */
  static extractDate(sessionId) {
    if (!sessionId || sessionId.length < 8) return null;
    const y = sessionId.slice(0, 4);
    const m = sessionId.slice(4, 6);
    const d = sessionId.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  /**
   * Serialize session data to v3 format.
   * @param {Object} data - Raw session data
   * @returns {Object} v3 formatted session
   */
  static serialize(data) {
    const {
      sessionId,
      startTime,
      endTime,
      timezone = 'UTC',
      treasureBox
    } = data;

    const durationSeconds = Math.round((endTime - startTime) / 1000);

    const result = {
      version: 3,
      session: {
        id: sessionId,
        date: this.extractDate(sessionId),
        start: this.formatTimestamp(startTime, timezone),
        end: this.formatTimestamp(endTime, timezone),
        duration_seconds: durationSeconds,
        timezone
      }
    };

    // Add totals block if treasureBox exists
    if (treasureBox) {
      result.totals = {
        coins: treasureBox.totalCoins,
        buckets: treasureBox.buckets
      };
    }

    return result;
  }
}
