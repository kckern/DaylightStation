/**
 * HealthAggregator
 *
 * Pure domain utility for aggregating health data from multiple sources
 * (weight, Strava, FitnessSyncer, nutrition) into unified daily health metrics.
 *
 * All methods are static and pure — no I/O, no side effects.
 * I/O orchestration lives in AggregateHealthUseCase (application layer).
 *
 * @module domains/health/services
 */

import { HealthMetric } from '../entities/HealthMetric.mjs';
import { WorkoutEntry } from '../entities/WorkoutEntry.mjs';

export class HealthAggregator {

  /**
   * Generate array of date strings going back N days from a reference date
   * @param {number} daysBack - Number of days to look back
   * @param {Date} today - Reference date for "today"
   * @returns {string[]} Array of YYYY-MM-DD date strings
   */
  static generateDateRange(daysBack, today) {
    const dates = [];

    for (let i = 0; i < daysBack; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  }

  /**
   * Aggregate metrics for a single day from multiple data sources
   * @param {string} date - YYYY-MM-DD
   * @param {Object} sources - Data sources for the day
   * @param {Object} [sources.weight] - Weight data
   * @param {Array} [sources.strava] - Strava activities
   * @param {Object} [sources.fitness] - FitnessSyncer data
   * @param {Object} [sources.nutrition] - Nutrition data
   * @param {Object} [sources.coaching] - Coaching data
   * @returns {HealthMetric}
   */
  static aggregateDayMetrics(date, sources) {
    const { weight, strava, fitness, nutrition, coaching } = sources;

    // Merge workouts from all sources
    const workouts = HealthAggregator.mergeWorkouts(strava, fitness?.activities || []);

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
   * Merge workouts from Strava and FitnessSyncer, matching by duration
   * @param {Array} stravaActivities - Strava workout data
   * @param {Array} fitnessActivities - FitnessSyncer workout data
   * @returns {WorkoutEntry[]}
   */
  static mergeWorkouts(stravaActivities, fitnessActivities) {
    const mergedWorkouts = [];
    const usedFitnessIds = new Set();

    // Duration tolerance for matching (5 minutes)
    const DURATION_TOLERANCE = 5;

    // Process Strava activities and try to match with FitnessSyncer
    for (const s of stravaActivities) {
      // Normalize heart rate data
      const stravaData = { ...s };
      if (Array.isArray(stravaData.heartRateOverTime)) {
        stravaData.heartRateOverTime = stravaData.heartRateOverTime.join('|');
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
   * Merge new health metrics into existing health data, sorted by date descending
   * @param {Object} existing - Existing health data keyed by date
   * @param {Object<string, HealthMetric>} newData - New metrics keyed by date
   * @returns {Object} Merged health data keyed by date (sorted descending)
   */
  static mergeHealthData(existing, newData) {
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

export default HealthAggregator;
