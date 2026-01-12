/**
 * HealthMetric Entity
 *
 * Represents daily health metrics aggregated from multiple sources.
 *
 * @module domains/health/entities
 */

export class HealthMetric {
  /**
   * @param {Object} data
   * @param {string} data.date - Date in YYYY-MM-DD format
   * @param {Object} [data.weight] - Weight metrics
   * @param {number} [data.weight.lbs] - Weight in pounds
   * @param {number} [data.weight.fatPercent] - Body fat percentage
   * @param {number} [data.weight.leanLbs] - Lean mass in pounds
   * @param {number} [data.weight.waterWeight] - Water weight
   * @param {number} [data.weight.trend] - 7-day trend
   * @param {Object} [data.nutrition] - Nutrition metrics
   * @param {number} [data.nutrition.calories] - Total calories
   * @param {number} [data.nutrition.protein] - Protein in grams
   * @param {number} [data.nutrition.carbs] - Carbs in grams
   * @param {number} [data.nutrition.fat] - Fat in grams
   * @param {number} [data.nutrition.foodCount] - Number of food items
   * @param {Object} [data.steps] - Step metrics
   * @param {number} [data.steps.count] - Step count
   * @param {number} [data.steps.bmr] - Basal metabolic rate
   * @param {number} [data.steps.duration] - Duration in minutes
   * @param {number} [data.steps.calories] - Calories burned
   * @param {number} [data.steps.maxHr] - Max heart rate
   * @param {number} [data.steps.avgHr] - Average heart rate
   * @param {Array} [data.workouts] - Array of WorkoutEntry objects
   * @param {Object} [data.coaching] - Coaching messages
   */
  constructor(data) {
    this.date = data.date;
    this.weight = data.weight || null;
    this.nutrition = data.nutrition || null;
    this.steps = data.steps || null;
    this.workouts = data.workouts || [];
    this.coaching = data.coaching || null;
  }

  /**
   * Get workout summary
   * @returns {Object}
   */
  getWorkoutSummary() {
    return {
      totalCalories: this.workouts.reduce((sum, w) => sum + (w.calories || 0), 0),
      totalDuration: this.workouts.reduce((sum, w) => sum + (w.duration || 0), 0),
      count: this.workouts.length
    };
  }

  /**
   * Check if there is weight data
   * @returns {boolean}
   */
  hasWeight() {
    return this.weight !== null && this.weight.lbs !== undefined;
  }

  /**
   * Check if there is nutrition data
   * @returns {boolean}
   */
  hasNutrition() {
    return this.nutrition !== null && this.nutrition.calories !== undefined;
  }

  /**
   * Check if there are workouts
   * @returns {boolean}
   */
  hasWorkouts() {
    return this.workouts.length > 0;
  }

  /**
   * Convert to plain object for storage
   * @returns {Object}
   */
  toJSON() {
    const summary = this.getWorkoutSummary();
    return {
      date: this.date,
      weight: this.weight,
      nutrition: this.nutrition,
      steps: this.steps,
      workouts: this.workouts,
      summary: {
        total_workout_calories: summary.totalCalories,
        total_workout_duration: summary.totalDuration
      },
      coaching: this.coaching
    };
  }

  /**
   * Create from stored data
   * @param {Object} data
   * @returns {HealthMetric}
   */
  static fromJSON(data) {
    return new HealthMetric(data);
  }
}

export default HealthMetric;
