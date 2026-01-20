/**
 * Fitness Lifelog Extractor
 *
 * Extracts fitness sync data from fitness.yml
 * Structure: Date-keyed object with steps and activities
 *
 * @module journalist/extractors
 */

import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * FitnessSyncer data extractor
 * @implements {ILifelogExtractor}
 */
export class FitnessExtractor extends ILifelogExtractor {
  get source() {
    return 'fitness';
  }

  get category() {
    return ExtractorCategory.FITNESS;
  }

  get filename() {
    return 'fitness';
  }

  /**
   * Extract fitness data for a specific date
   * @param {Object} data - Full fitness.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted data or null
   */
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;

    const result = {
      steps: day.steps?.steps_count || 0,
      stepsBmr: day.steps?.bmr,
      stepsCalories: day.steps?.calories,
      stepsMaxHR: day.steps?.maxHeartRate,
      stepsAvgHR: day.steps?.avgHeartRate,
      activities: [],
    };

    if (day.activities?.length) {
      result.activities = day.activities.map((a) => ({
        title: a.title,
        startTime: a.startTime,
        endTime: a.endTime,
        duration: Math.round(a.minutes),
        calories: a.calories,
        distance: a.distance,
        avgHR: a.avgHeartrate,
      }));
    }

    // Only return if there's meaningful data
    if (!result.steps && !result.activities.length) return null;
    return result;
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry) return null;
    const lines = ['FITNESS DATA:'];

    if (entry.steps) {
      const hr = entry.stepsAvgHR
        ? `, avg HR ${entry.stepsAvgHR}, max HR ${entry.stepsMaxHR}`
        : '';
      lines.push(`  Steps: ${entry.steps}${hr}`);
    }

    if (entry.activities?.length) {
      lines.push(`  Activities (${entry.activities.length}):`);
      entry.activities.forEach((a) => {
        const hr = a.avgHR ? `, avg HR ${a.avgHR}` : '';
        lines.push(
          `    - ${a.startTime}-${a.endTime}: ${a.title} - ${a.duration} minutes, ${a.calories} calories${hr}`
        );
      });
    }

    return lines.length > 1 ? lines.join('\n') : null;
  }
}

// Export singleton instance for backward compatibility
export const fitnessExtractor = new FitnessExtractor();

export default FitnessExtractor;
