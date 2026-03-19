import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';
import { CalorieAdjustmentService } from '#domains/health/services/CalorieAdjustmentService.mjs';

const LBS_TO_KG = 1 / 2.205;

export class ReconciliationProcessor {
  #healthStore;
  #logger;
  #nutritionItemsReader;

  constructor(config) {
    if (!config.healthStore) {
      throw new Error('ReconciliationProcessor requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
    this.#nutritionItemsReader = config.nutritionItemsReader || null;
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
      const rawFitnessActivities = fitness?.activities || [];

      // Deduplicate fitness activities — FitnessSyncer harvester has a known bug
      // where the same activity appears multiple times in the same day
      const seen = new Set();
      const fitnessActivities = rawFitnessActivities.filter(a => {
        const key = `${a.title}|${a.minutes}|${a.calories}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const mergedWorkouts = HealthAggregator.mergeWorkouts(stravaActivities, fitnessActivities);

      // Estimate calories from HR when calories are missing (common for Strava weight training)
      const weightKg = currWeight ? currWeight * LBS_TO_KG : null;
      const exerciseCalories = mergedWorkouts.reduce((sum, w) => {
        if (w.calories > 0) return sum + w.calories;
        // Fall back to HR-based estimation
        const hr = w.avgHr || w.strava?.avgHeartrate || w.fitness?.avgHeartrate;
        const dur = w.duration || w.strava?.minutes || w.fitness?.minutes;
        if (hr && dur && weightKg) {
          return sum + CalorieReconciliationService.estimateCaloriesFromHR(hr, dur, weightKg);
        }
        return sum;
      }, 0);

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

    // Run calorie adjustment if nutrition items reader is available
    if (this.#nutritionItemsReader && results.length > 0) {
      try {
        await this.#produceAdjustedNutrition(userId, results, windowDates);
      } catch (error) {
        this.#logger.error?.('reconciliation.adjustment.failed', {
          userId, error: error.message
        });
      }
    }

    this.#logger.info?.('reconciliation.process.complete', {
      userId, days: results.length, derivedBmr: results[results.length - 1]?.derived_bmr
    });

    return results;
  }

  async #produceAdjustedNutrition(userId, reconciliationResults, windowDates) {
    const startDate = windowDates[0];
    const endDate = windowDates[windowDates.length - 1];

    const nutrilistItems = await this.#nutritionItemsReader.findByDateRange(userId, startDate, endDate);
    const existingAdjusted = await this.#healthStore.loadAdjustedNutritionData(userId);

    const windowStats = CalorieAdjustmentService.computeWindowStats(reconciliationResults);
    if (!windowStats.avgAccuracy) return;

    // Group nutrilist items by date
    const itemsByDate = {};
    for (const item of nutrilistItems) {
      if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
      itemsByDate[item.date].push(item);
    }

    const adjusted = { ...existingAdjusted };
    for (const record of reconciliationResults) {
      const dayItems = itemsByDate[record.date] || [];
      const result = CalorieAdjustmentService.adjustDay(dayItems, record, windowStats);
      if (!result) continue;

      const allItems = [...result.adjustedItems];
      if (result.phantomEntry) allItems.push(result.phantomEntry);

      adjusted[record.date] = {
        calories: allItems.reduce((s, i) => s + (i.calories || 0), 0),
        protein: allItems.reduce((s, i) => s + (i.protein || 0), 0),
        carbs: allItems.reduce((s, i) => s + (i.carbs || 0), 0),
        fat: allItems.reduce((s, i) => s + (i.fat || 0), 0),
        fiber: allItems.reduce((s, i) => s + (i.fiber || 0), 0),
        sodium: allItems.reduce((s, i) => s + (i.sodium || 0), 0),
        sugar: allItems.reduce((s, i) => s + (i.sugar || 0), 0),
        cholesterol: allItems.reduce((s, i) => s + (i.cholesterol || 0), 0),
        items: allItems,
        adjustment_metadata: result.metadata,
      };
    }

    await this.#healthStore.saveAdjustedNutritionData(userId, adjusted);
  }
}

export default ReconciliationProcessor;
