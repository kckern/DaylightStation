/**
 * AggregateHealthUseCase
 *
 * Application-layer use case that orchestrates health data I/O
 * and delegates pure aggregation logic to the domain HealthAggregator.
 *
 * @module applications/health
 */

import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';
import { HealthMetric } from '#domains/health/entities/HealthMetric.mjs';

export class AggregateHealthUseCase {
  #healthStore;

  /**
   * @param {Object} config
   * @param {Object} config.healthStore - IHealthDataDatastore implementation
   */
  constructor(config) {
    if (!config.healthStore) {
      throw new Error('AggregateHealthUseCase requires healthStore');
    }
    this.#healthStore = config.healthStore;
  }

  /**
   * Aggregate daily health data for a user.
   *
   * Loads data from all sources in parallel, delegates pure aggregation
   * to HealthAggregator, then persists the merged result.
   *
   * @param {string} userId
   * @param {number} [daysBack=15] - Number of days to look back
   * @param {Date} today - Reference date for "today" (required)
   * @returns {Promise<Object<string, HealthMetric>>} Health metrics keyed by date
   */
  async execute(userId, daysBack = 15, today) {
    if (!today || !(today instanceof Date)) {
      throw new Error('today date required for AggregateHealthUseCase.execute');
    }

    // Load all data sources in parallel (I/O)
    const [weightData, activityData, fitnessData, nutritionData, existingHealth, coachingData] =
      await Promise.all([
        this.#healthStore.loadWeightData(userId),
        this.#healthStore.loadActivityData(userId),
        this.#healthStore.loadFitnessData(userId),
        this.#healthStore.loadNutritionData(userId),
        this.#healthStore.loadHealthData(userId),
        this.#healthStore.loadCoachingData(userId)
      ]);

    // Generate date range (pure)
    const dates = HealthAggregator.generateDateRange(daysBack, today);

    // Aggregate metrics for each day (pure)
    const metrics = {};
    for (const date of dates) {
      const metric = HealthAggregator.aggregateDayMetrics(date, {
        weight: weightData[date],
        strava: activityData[date] || [],
        fitness: fitnessData[date],
        nutrition: nutritionData[date],
        coaching: coachingData[date]
      });
      metrics[date] = metric;
    }

    // Merge with existing health data (pure)
    const mergedHealth = HealthAggregator.mergeHealthData(existingHealth, metrics);

    // Save aggregated data (I/O)
    await this.#healthStore.saveHealthData(userId, mergedHealth);

    return metrics;
  }

  /**
   * Get health metrics for a specific date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<HealthMetric|null>}
   */
  async getHealthForDate(userId, date) {
    const healthData = await this.#healthStore.loadHealthData(userId);
    const dayData = healthData[date];
    return dayData ? HealthMetric.fromJSON(dayData) : null;
  }

  /**
   * Get health metrics for a date range
   * @param {string} userId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Object<string, HealthMetric>>}
   */
  async getHealthForRange(userId, startDate, endDate) {
    const healthData = await this.#healthStore.loadHealthData(userId);
    const result = {};

    for (const [date, data] of Object.entries(healthData)) {
      if (date >= startDate && date <= endDate) {
        result[date] = HealthMetric.fromJSON(data);
      }
    }

    return result;
  }
}

export default AggregateHealthUseCase;
