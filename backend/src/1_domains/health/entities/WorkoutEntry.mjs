/**
 * WorkoutEntry Entity
 *
 * Represents a workout entry merged from multiple data sources
 * (Strava, Garmin, FitnessSyncer).
 *
 * @module domains/health/entities
 */

export class WorkoutEntry {
  /**
   * Data sources for workouts
   */
  static SOURCES = {
    STRAVA: 'strava',
    GARMIN: 'garmin',
    FITNESS: 'fitness',
    STRAVA_GARMIN: 'strava+garmin',
    STRAVA_FITNESS: 'strava+fitness'
  };

  /**
   * @param {Object} data
   * @param {string} data.source - Data source(s) (e.g., 'strava', 'garmin', 'strava+garmin')
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
   * @param {Object} [data.garmin] - Raw Garmin data
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
    this.garmin = data.garmin || null;
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
   * Check if workout includes Garmin data
   * @returns {boolean}
   */
  hasGarmin() {
    return this.source.includes('garmin');
  }

  /**
   * Check if workout is merged from multiple sources
   * @returns {boolean}
   */
  isMerged() {
    return this.source.includes('+');
  }

  /**
   * Convert to plain object for storage
   * @returns {Object}
   */
  toJSON() {
    const result = {
      source: this.source,
      title: this.title,
      type: this.type,
      duration: this.duration,
      calories: this.calories
    };

    if (this.avgHr) result.avgHr = this.avgHr;
    if (this.maxHr) result.maxHr = this.maxHr;
    if (this.distance) result.distance = this.distance;
    if (this.startTime) result.startTime = this.startTime;
    if (this.endTime) result.endTime = this.endTime;
    if (this.strava) result.strava = this.strava;
    if (this.garmin) result.garmin = this.garmin;
    if (this.fitness) result.fitness = this.fitness;

    return result;
  }

  /**
   * Create from stored data
   * @param {Object} data
   * @returns {WorkoutEntry}
   */
  static fromJSON(data) {
    return new WorkoutEntry(data);
  }
}

export default WorkoutEntry;
