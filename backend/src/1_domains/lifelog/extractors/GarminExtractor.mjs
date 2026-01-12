/**
 * Garmin Lifelog Extractor
 *
 * Extracts daily health data from garmin.yml
 * Structure: Date-keyed object with weight, nutrition, steps, workouts
 *
 * @module journalist/extractors
 */

import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * Garmin health data extractor
 * @implements {ILifelogExtractor}
 */
export class GarminExtractor extends ILifelogExtractor {
  get source() {
    return 'garmin';
  }

  get category() {
    return ExtractorCategory.HEALTH;
  }

  get filename() {
    return 'garmin';
  }

  /**
   * Extract data for a specific date
   * @param {Object} data - Full garmin.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted data or null
   */
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;

    return {
      weight: day.weight,
      nutrition: day.nutrition,
      steps: day.steps,
      workouts: day.workouts || [],
      summary: day.summary,
    };
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Object} entry - Extracted data from extractForDate
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry) return null;
    const lines = [];

    // Weight - full metrics
    if (entry.weight?.lbs) {
      lines.push(
        `WEIGHT: ${entry.weight.lbs}lbs, ${entry.weight.fat_percent}% body fat, ${entry.weight.lean_lbs}lbs lean mass`
      );
    }

    // Nutrition - full breakdown
    if (entry.nutrition?.calories) {
      lines.push(
        `NUTRITION: ${entry.nutrition.calories} calories consumed (${entry.nutrition.protein}g protein, ${entry.nutrition.carbs}g carbs, ${entry.nutrition.fat}g fat) from ${entry.nutrition.food_count} food entries`
      );
    }

    // Steps - full data
    if (entry.steps?.count) {
      lines.push(
        `STEPS: ${entry.steps.count} steps, avg HR ${entry.steps.avgHr}, max HR ${entry.steps.maxHr}`
      );
    }

    // Workouts - list ALL workouts with full details
    if (entry.workouts?.length) {
      lines.push(`WORKOUTS (${entry.workouts.length}):`);
      entry.workouts.forEach((w) => {
        lines.push(
          `  - ${w.title}: ${Math.round(w.duration)} minutes, ${w.calories} calories burned, avg HR ${Math.round(w.avgHr)}, max HR ${w.maxHr}`
        );
      });
    }

    return lines.length ? lines.join('\n') : null;
  }
}

// Export singleton instance for backward compatibility
export const garminExtractor = new GarminExtractor();

export default GarminExtractor;
