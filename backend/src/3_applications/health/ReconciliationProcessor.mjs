import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

export class ReconciliationProcessor {
  #healthStore;
  #logger;

  constructor(config) {
    if (!config.healthStore) {
      throw new Error('ReconciliationProcessor requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  async process(userId, options = {}) {
    const windowDays = options.windowDays || 14;
    this.#logger.info?.('reconciliation.process.start', { userId, windowDays });

    const [weightData, nutritionData, fitnessData, stravaData, existingRecon] = await Promise.all([
      this.#healthStore.loadWeightData(userId),
      this.#healthStore.loadNutritionData(userId),
      this.#healthStore.loadFitnessData(userId),
      this.#healthStore.loadActivityData(userId),
      this.#healthStore.loadReconciliationData(userId),
    ]);

    const weightDates = Object.keys(weightData).sort();
    if (weightDates.length < 2) {
      this.#logger.warn?.('reconciliation.process.insufficient_weight_data', { userId, dates: weightDates.length });
      return [];
    }

    // Exclude today — morning weigh-in may not have happened yet
    const today = options.today || new Date().toISOString().slice(0, 10);
    const eligibleDates = weightDates.filter(d => d < today);
    const windowDates = eligibleDates.slice(-windowDays);

    if (windowDates.length < 2) {
      this.#logger.warn?.('reconciliation.process.insufficient_window', { userId });
      return [];
    }

    const latestWeight = weightData[windowDates[windowDates.length - 1]];
    const seedBmr = CalorieReconciliationService.computeSeedBmr(
      latestWeight?.lbs_adjusted_average,
      latestWeight?.fat_percent_adjusted_average
    );

    if (!seedBmr) {
      this.#logger.warn?.('reconciliation.process.no_seed_bmr', { userId });
      return [];
    }

    const windowData = windowDates.map((date, i) => {
      const prevDate = i > 0 ? windowDates[i - 1] : weightDates[weightDates.indexOf(date) - 1];
      const currWeight = weightData[date]?.lbs_adjusted_average;
      const prevWeight = prevDate ? weightData[prevDate]?.lbs_adjusted_average : null;
      const weightDelta = (currWeight != null && prevWeight != null) ? currWeight - prevWeight : 0;

      const nutrition = nutritionData[date];
      const fitness = fitnessData[date];
      const strava = stravaData[date];

      // Deduplicate exercise calories — strava.yml entries may or may not have `calories`.
      // mergeWorkouts takes max(strava, fitness) for duplicate activities.
      const stravaActivities = Array.isArray(strava) ? strava : [];
      const fitnessActivities = fitness?.activities || [];
      const mergedWorkouts = HealthAggregator.mergeWorkouts(stravaActivities, fitnessActivities);
      const exerciseCalories = mergedWorkouts.reduce((sum, w) => sum + (w.calories || 0), 0);

      return {
        date,
        weightDelta,
        trackedCalories: nutrition?.calories || 0,
        exerciseCalories,
        neatCalories: fitness?.steps?.calories ?? null,
        hasWeight: currWeight != null,
        hasNutrition: nutrition?.calories > 0,
        hasSteps: fitness?.steps?.calories != null,
      };
    });

    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);

    const merged = { ...existingRecon };
    for (const record of results) {
      merged[record.date] = record;
    }
    await this.#healthStore.saveReconciliationData(userId, merged);

    this.#logger.info?.('reconciliation.process.complete', {
      userId, days: results.length, derivedBmr: results[results.length - 1]?.derived_bmr
    });

    return results;
  }
}

export default ReconciliationProcessor;
