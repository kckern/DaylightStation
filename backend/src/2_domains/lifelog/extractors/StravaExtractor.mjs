/**
 * Strava Lifelog Extractor
 *
 * Extracts workout activities from strava.yml
 * Structure: Date-keyed object with array of activities
 *
 * @module journalist/extractors
 */

import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * Strava activities extractor
 * @implements {ILifelogExtractor}
 */
export class StravaExtractor extends ILifelogExtractor {
  get source() {
    return 'strava';
  }

  get category() {
    return ExtractorCategory.FITNESS;
  }

  get filename() {
    return 'strava';
  }

  /**
   * Extract activities for a specific date
   * @param {Object} data - Full strava.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of activities or null
   */
  extractForDate(data, date) {
    const activities = data?.[date];
    if (!Array.isArray(activities) || !activities.length) return null;

    return activities.map((a) => ({
      title: a.title,
      type: a.type,
      startTime: a.startTime,
      duration: Math.round(a.minutes),
      avgHR: a.avgHeartrate ? Math.round(a.avgHeartrate) : null,
      maxHR: a.maxHeartrate,
      sufferScore: a.suffer_score,
      device: a.device_name,
    }));
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted activities
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;

    const lines = [`STRAVA ACTIVITIES (${entries.length}):`];
    entries.forEach((e) => {
      const hr = e.avgHR ? `, avg HR ${e.avgHR}, max HR ${e.maxHR}` : '';
      const suffer = e.sufferScore ? `, suffer score ${e.sufferScore}` : '';
      lines.push(
        `  - ${e.startTime}: ${e.title} (${e.type}) - ${e.duration} minutes${hr}${suffer}`
      );
    });

    return lines.join('\n');
  }
}

// Export singleton instance for backward compatibility
export const stravaExtractor = new StravaExtractor();

export default StravaExtractor;
