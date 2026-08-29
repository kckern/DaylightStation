/**
 * WorkoutEntry Entity
 *
 * Represents a workout entry merged from multiple data sources
 * (Strava, FitnessSyncer).
 *
 * @module domains/health/entities
 */

export class WorkoutEntry {
  /**
   * Data sources for workouts
   */
  static SOURCES = {
    STRAVA: 'strava',
    FITNESS: 'fitness',
    STRAVA_FITNESS: 'strava+fitness'
  };

  /**
   * @param {Object} data
   * @param {string} data.source - Data source(s) (e.g., 'strava', 'fitness', 'strava+fitness')
   * @param {string} data.title - Workout title
   * @param {string} data.type - Activity type (e.g., 'Run', 'Ride')
   * @param {number} [data.duration] - Duration in minutes
   * @param {number} [data.calories] - Calories burned
   * @param {number} [data.avgHr] - Average heart rate
   * @param {number} [data.maxHr] - Maximum heart rate
   * @param {number} [data.distance] - Distance
   * @param {string} [data.startTime] - Start time
   * @param {string} [data.endTime] - End time
   * @param {Object} [data.strava] - Raw Strava data
   * @param {Object} [data.fitness] - Raw FitnessSyncer data
   */
  constructor(data) {
    this.source = data.source;
    this.title = data.title;
    this.type = data.type;
    this.duration = data.duration || 0;
    this.calories = data.calories || 0;
    this.avgHr = data.avgHr || null;
    this.maxHr = data.maxHr || null;
    this.distance = data.distance || null;
    this.startTime = data.startTime || null;
    this.endTime = data.endTime || null;

    // Raw source data
    this.strava = data.strava || null;
    this.fitness = data.fitness || null;
  }

  /**
   * Check if workout includes Strava data
   * @returns {boolean}
   */
  hasStrava() {
    return this.source.includes('strava');
  }

  /**
   * Check if workout is merged from multiple sources
   * @returns {boolean}
   */
  isMerged() {
    return this.source.includes('+');
  }

}

export default WorkoutEntry;
