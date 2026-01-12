/**
 * HealthAggregationService
 *
 * Aggregates health data from multiple sources (weight, Strava, Garmin,
 * FitnessSyncer, nutrition) into unified daily health metrics.
 *
 * @module domains/health/services
 */

import { HealthMetric } from '../entities/HealthMetric.mjs';
import { WorkoutEntry } from '../entities/WorkoutEntry.mjs';

export class HealthAggregationService {
  #healthStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.healthStore - IHealthDataStore implementation
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.healthStore) {
      throw new Error('HealthAggregationService requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  /**
   * Aggregate daily health data for a user
   * @param {string} userId
   * @param {number} [daysBack=15] - Number of days to look back
   * @returns {Promise<Object<string, HealthMetric>>} Health metrics keyed by date
   */
  async aggregateDailyHealth(userId, daysBack = 15) {
    this.#logger.debug?.('health.aggregate.start', { userId, daysBack });

    // Load all data sources in parallel
    const [weightData, stravaData, garminData, fitnessData, nutritionData, existingHealth, coachingData] =
      await Promise.all([
        this.#healthStore.loadWeightData(userId),
        this.#healthStore.loadStravaData(userId),
        this.#healthStore.loadGarminData(userId),
        this.#healthStore.loadFitnessData(userId),
        this.#healthStore.loadNutritionData(userId),
        this.#healthStore.loadHealthData(userId),
        this.#healthStore.loadCoachingData(userId)
      ]);

    // Generate date range
    const dates = this.#generateDateRange(daysBack);

    // Aggregate metrics for each day
    const metrics = {};
    for (const date of dates) {
      const metric = this.#aggregateDayMetrics(date, {
        weight: weightData[date],
        strava: stravaData[date] || [],
        garmin: garminData[date] || [],
        fitness: fitnessData[date],
        nutrition: nutritionData[date],
        coaching: coachingData[date]
      });
      metrics[date] = metric;
    }

    // Merge with existing health data
    const mergedHealth = this.#mergeHealthData(existingHealth, metrics);

    // Save aggregated data
    await this.#healthStore.saveHealthData(userId, mergedHealth);

    this.#logger.info?.('health.aggregate.complete', {
      userId,
      daysProcessed: dates.length,
      daysWithWeight: Object.values(metrics).filter(m => m.hasWeight()).length,
      daysWithWorkouts: Object.values(metrics).filter(m => m.hasWorkouts()).length
    });

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

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Generate array of dates going back N days
   * @private
   */
  #generateDateRange(daysBack) {
    const dates = [];
    const today = new Date();

    for (let i = 0; i < daysBack; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  }

  /**
   * Aggregate metrics for a single day
   * @private
   */
  #aggregateDayMetrics(date, sources) {
    const { weight, strava, garmin, fitness, nutrition, coaching } = sources;

    // Merge workouts from all sources
    const workouts = this.#mergeWorkouts(strava, garmin, fitness?.activities || []);

    // Build weight data
    const weightData = weight ? {
      lbs: weight.lbs,
      fatPercent: weight.fat_percent,
      leanLbs: weight.lean_lbs,
      waterWeight: weight.water_weight,
      trend: weight.lbs_adjusted_average_7day_trend
    } : null;

    // Build nutrition data
    const nutritionData = nutrition ? {
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      foodCount: nutrition.food_items?.length || 0
    } : null;

    // Build steps data
    const stepsData = fitness?.steps ? {
      count: fitness.steps.steps_count,
      bmr: fitness.steps.bmr,
      duration: fitness.steps.duration,
      calories: fitness.steps.calories,
      maxHr: fitness.steps.maxHeartRate,
      avgHr: fitness.steps.avgHeartRate
    } : null;

    return new HealthMetric({
      date,
      weight: weightData,
      nutrition: nutritionData,
      steps: stepsData,
      workouts: workouts.map(w => w.toJSON()),
      coaching
    });
  }

  /**
   * Merge workouts from Strava, Garmin, and FitnessSyncer
   * @private
   */
  #mergeWorkouts(stravaActivities, garminActivities, fitnessActivities) {
    const mergedWorkouts = [];
    const usedGarminIds = new Set();
    const usedFitnessIds = new Set();

    // Duration tolerance for matching (5 minutes)
    const DURATION_TOLERANCE = 5;

    // Process Strava activities and try to match with Garmin or FitnessSyncer
    for (const s of stravaActivities) {
      // Normalize heart rate data
      const stravaData = { ...s };
      if (Array.isArray(stravaData.heartRateOverTime)) {
        stravaData.heartRateOverTime = stravaData.heartRateOverTime.join('|');
      }

      // Try to match with Garmin
      const garminMatch = garminActivities.find(g => {
        if (usedGarminIds.has(g.activityId)) return false;
        const durationDiff = Math.abs((s.minutes || 0) - (g.duration || 0));
        return durationDiff < DURATION_TOLERANCE;
      });

      if (garminMatch) {
        usedGarminIds.add(garminMatch.activityId);
        mergedWorkouts.push(new WorkoutEntry({
          source: WorkoutEntry.SOURCES.STRAVA_GARMIN,
          title: s.title,
          type: s.type || garminMatch.activityName,
          duration: s.minutes,
          calories: Math.max(s.calories || 0, garminMatch.calories || 0),
          avgHr: s.avgHeartrate || garminMatch.averageHR,
          maxHr: s.maxHeartrate || garminMatch.maxHR,
          strava: stravaData,
          garmin: garminMatch
        }));
        continue;
      }

      // Try to match with FitnessSyncer
      const fitnessMatch = fitnessActivities.find((f, idx) => {
        if (usedFitnessIds.has(idx)) return false;
        const durationDiff = Math.abs((s.minutes || 0) - (f.minutes || 0));
        return durationDiff < DURATION_TOLERANCE;
      });

      if (fitnessMatch) {
        const idx = fitnessActivities.indexOf(fitnessMatch);
        usedFitnessIds.add(idx);
        mergedWorkouts.push(new WorkoutEntry({
          source: WorkoutEntry.SOURCES.STRAVA_FITNESS,
          title: s.title || fitnessMatch.title,
          type: s.type,
          duration: s.minutes,
          calories: Math.max(s.calories || 0, fitnessMatch.calories || 0),
          avgHr: s.avgHeartrate || fitnessMatch.avgHeartrate,
          maxHr: s.maxHeartrate,
          strava: stravaData,
          fitness: fitnessMatch
        }));
        continue;
      }

      // No match - Strava only
      mergedWorkouts.push(new WorkoutEntry({
        source: WorkoutEntry.SOURCES.STRAVA,
        title: s.title,
        type: s.type,
        duration: s.minutes,
        calories: s.calories,
        avgHr: s.avgHeartrate,
        maxHr: s.maxHeartrate,
        strava: stravaData
      }));
    }

    // Add remaining Garmin activities
    for (const g of garminActivities) {
      if (!usedGarminIds.has(g.activityId)) {
        mergedWorkouts.push(new WorkoutEntry({
          source: WorkoutEntry.SOURCES.GARMIN,
          title: g.activityName,
          type: g.activityName,
          duration: g.duration,
          calories: g.calories,
          avgHr: g.averageHR,
          maxHr: g.maxHR,
          garmin: g
        }));
      }
    }

    // Add remaining FitnessSyncer activities
    fitnessActivities.forEach((f, idx) => {
      if (!usedFitnessIds.has(idx)) {
        mergedWorkouts.push(new WorkoutEntry({
          source: WorkoutEntry.SOURCES.FITNESS,
          title: f.title,
          type: 'Activity',
          duration: f.minutes,
          calories: f.calories,
          avgHr: f.avgHeartrate,
          distance: f.distance,
          startTime: f.startTime,
          endTime: f.endTime,
          fitness: f
        }));
      }
    });

    return mergedWorkouts;
  }

  /**
   * Merge new health data with existing data
   * @private
   */
  #mergeHealthData(existing, newData) {
    const merged = { ...existing };

    for (const [date, metric] of Object.entries(newData)) {
      merged[date] = metric.toJSON();
    }

    // Sort by date descending
    return Object.keys(merged)
      .sort()
      .reverse()
      .reduce((acc, key) => {
        acc[key] = merged[key];
        return acc;
      }, {});
  }
}

export default HealthAggregationService;
