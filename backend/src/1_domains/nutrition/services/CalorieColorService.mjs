// backend/src/1_domains/nutrition/services/CalorieColorService.mjs

/**
 * CalorieColorService
 *
 * Domain service for classifying foods by calorie density.
 * Uses a color system (green/yellow/orange) based on calories per gram.
 *
 * @module domains/nutrition/services/CalorieColorService
 */

/**
 * Calorie density classification thresholds
 */
const DENSITY_THRESHOLDS = {
  LOW: 1.0,      // Below this = green
  MEDIUM: 2.4,   // Below this = yellow, above = orange
};

/**
 * Categories that are automatically green regardless of density
 */
const GREEN_CATEGORIES = ['vegetables', 'fruits', 'salads', 'leafy'];

/**
 * Service for classifying foods by calorie density
 */
export class CalorieColorService {
  /**
   * Classify a food by its calorie density
   *
   * @param {Object} params
   * @param {number} params.calories - Calories in the serving
   * @param {number} params.servingGrams - Serving size in grams
   * @param {string[]} [params.categories=[]] - Food categories for special handling
   * @returns {'green'|'yellow'|'orange'} Color classification
   */
  classifyByDensity({ calories, servingGrams, categories = [] }) {
    // Check categories for automatic green classification
    if (this.#isGreenCategory(categories)) {
      return 'green';
    }

    // Calculate calorie density
    const density = this.#calculateDensity(calories, servingGrams);

    // Classify by density thresholds
    if (density < DENSITY_THRESHOLDS.LOW) return 'green';
    if (density <= DENSITY_THRESHOLDS.MEDIUM) return 'yellow';
    return 'orange';
  }

  /**
   * Calculate calorie density (calories per gram)
   * @param {number} calories
   * @param {number} grams
   * @returns {number}
   */
  calculateDensity(calories, grams) {
    return this.#calculateDensity(calories, grams);
  }

  /**
   * Get density thresholds for reference
   * @returns {Object}
   */
  getThresholds() {
    return { ...DENSITY_THRESHOLDS };
  }

  /**
   * Check if any category matches green food categories
   * @private
   */
  #isGreenCategory(categories) {
    if (!Array.isArray(categories)) return false;
    return categories.some(cat =>
      GREEN_CATEGORIES.some(green => cat.toLowerCase().includes(green))
    );
  }

  /**
   * Calculate calorie density (calories per gram)
   * @private
   */
  #calculateDensity(calories, grams) {
    const g = Number(grams) || 100;
    const cal = Number(calories) || 0;
    return g > 0 ? cal / g : 0;
  }
}

export default CalorieColorService;
