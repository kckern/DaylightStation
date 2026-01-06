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

  /**
   * Compute HR statistics from a heart rate series.
   * @param {Array<number|null>} hrSeries
   * @returns {{min: number, max: number, avg: number}}
   */
  static computeHrStats(hrSeries) {
    const validValues = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0);
    if (validValues.length === 0) {
      return { min: 0, max: 0, avg: 0 };
    }
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const sum = validValues.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / validValues.length);
    return { min, max, avg };
  }

  /**
   * Compute time spent in each zone from zone series.
   * @param {Array<string|null>} zoneSeries - Zone IDs ('c', 'a', 'w', 'h', etc.)
   * @param {number} intervalSeconds
   * @returns {Object} Zone name -> seconds
   */
  static computeZoneTime(zoneSeries, intervalSeconds = 5) {
    const ZONE_MAP = { c: 'cool', a: 'active', w: 'warm', h: 'hot', fire: 'fire' };
    const counts = {};
    (zoneSeries || []).forEach(z => {
      if (z == null) return;
      const zoneName = ZONE_MAP[z] || z;
      counts[zoneName] = (counts[zoneName] || 0) + intervalSeconds;
    });
    return counts;
  }

  /**
   * Compute active seconds (time with valid HR data).
   * @param {Array<number|null>} hrSeries
   * @param {number} intervalSeconds
   * @returns {number}
   */
  static computeActiveSeconds(hrSeries, intervalSeconds = 5) {
    const validCount = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0).length;
    return validCount * intervalSeconds;
  }
}
