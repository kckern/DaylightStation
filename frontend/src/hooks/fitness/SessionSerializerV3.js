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
      treasureBox,
      participants: participantsMeta,
      timeline
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

    // Build participants block
    const intervalSeconds = (timeline?.timebase?.intervalMs || 5000) / 1000;
    const series = timeline?.series || {};
    const participants = {};

    if (participantsMeta) {
      Object.entries(participantsMeta).forEach(([userId, meta]) => {
        const hrSeries = this.decodeSeries(series[`user:${userId}:heart_rate`]);
        const zoneSeries = this.decodeSeries(series[`user:${userId}:zone_id`]);
        const coinsSeries = this.decodeSeries(series[`user:${userId}:coins_total`]);
        const beatsSeries = this.decodeSeries(series[`user:${userId}:heart_beats`]);

        participants[userId] = {
          display_name: meta.display_name,
          is_primary: meta.is_primary || false,
          is_guest: meta.is_guest || false,
          ...(meta.hr_device && { hr_device: meta.hr_device }),
          ...(meta.cadence_device && { cadence_device: meta.cadence_device }),
          coins_earned: this.getLastValue(coinsSeries),
          active_seconds: this.computeActiveSeconds(hrSeries, intervalSeconds),
          zone_time_seconds: this.computeZoneTime(zoneSeries, intervalSeconds),
          hr_stats: this.computeHrStats(hrSeries),
          total_beats: this.getLastValue(beatsSeries)
        };
      });
    }

    result.participants = participants;

    // Build timeline block
    const timelineOutput = {
      interval_seconds: Math.round((timeline?.timebase?.intervalMs || 5000) / 1000),
      tick_count: timeline?.timebase?.tickCount || 0,
      encoding: 'rle',
      participants: {},
      equipment: {},
      global: {}
    };

    Object.entries(series).forEach(([key, values]) => {
      if (this.isEmptySeries(values)) return;

      const mapped = this.mapSeriesKey(key);
      if (!mapped) return;

      const { type, id, metric } = mapped;
      const encoded = typeof values === 'string' ? values : this.encodeSeries(values);

      if (type === 'participants') {
        if (!timelineOutput.participants[id]) timelineOutput.participants[id] = {};
        timelineOutput.participants[id][metric] = encoded;
      } else if (type === 'equipment') {
        if (!timelineOutput.equipment[id]) timelineOutput.equipment[id] = {};
        timelineOutput.equipment[id][metric] = encoded;
      } else if (type === 'global') {
        timelineOutput.global[metric] = encoded;
      }
    });

    // Remove empty sections
    if (Object.keys(timelineOutput.equipment).length === 0) delete timelineOutput.equipment;
    if (Object.keys(timelineOutput.global).length === 0) delete timelineOutput.global;

    result.timeline = timelineOutput;

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

  /**
   * Get the last non-null value from a series.
   * @param {Array} series
   * @returns {*}
   */
  static getLastValue(series) {
    for (let i = (series || []).length - 1; i >= 0; i--) {
      if (series[i] != null) return series[i];
    }
    return 0;
  }

  /**
   * Decode RLE series if needed.
   * @param {Array|string} series
   * @returns {Array}
   */
  static decodeSeries(series) {
    if (typeof series === 'string') {
      try {
        const parsed = JSON.parse(series);
        const decoded = [];
        for (const entry of parsed) {
          if (Array.isArray(entry)) {
            const [value, count] = entry;
            for (let i = 0; i < count; i++) decoded.push(value);
          } else {
            decoded.push(entry);
          }
        }
        return decoded;
      } catch {
        return [];
      }
    }
    return series || [];
  }

  /**
   * Check if series is empty/trivial (all null or all zero).
   * @param {Array|string} series
   * @returns {boolean}
   */
  static isEmptySeries(series) {
    const decoded = this.decodeSeries(series);
    if (!decoded || decoded.length === 0) return true;
    return decoded.every(v => v == null || v === 0);
  }

  /**
   * Encode series to RLE format.
   * @param {Array} series
   * @returns {string|null}
   */
  static encodeSeries(series) {
    if (!Array.isArray(series) || series.length === 0) return null;

    const rle = [];
    for (const value of series) {
      const last = rle[rle.length - 1];
      if (Array.isArray(last) && last[0] === value) {
        last[1] += 1;
      } else if (last === value) {
        rle[rle.length - 1] = [value, 2];
      } else {
        rle.push(value);
      }
    }
    return JSON.stringify(rle);
  }

  /**
   * Map v2 series key to v3 nested structure.
   * @param {string} key
   * @returns {{type: string, id: string|null, metric: string}|null}
   */
  static mapSeriesKey(key) {
    const METRIC_MAP = {
      heart_rate: 'hr',
      zone_id: 'zone',
      coins_total: 'coins',
      heart_beats: 'beats'
    };

    const parts = key.split(':');
    if (parts.length < 2) return null;

    const [prefix, id, ...metricParts] = parts;
    const rawMetric = metricParts.join(':') || id;
    const metric = METRIC_MAP[rawMetric] || rawMetric;

    if (prefix === 'user') {
      return { type: 'participants', id, metric };
    } else if (prefix === 'device' || prefix === 'bike') {
      return { type: 'equipment', id: id.replace('device_', ''), metric };
    } else if (prefix === 'global') {
      return { type: 'global', id: null, metric: METRIC_MAP[id] || id };
    }
    return null;
  }
}
