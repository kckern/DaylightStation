const CALORIES_PER_LB = 3500;

const CONFIDENCE_WEIGHTS = {
  weight: 0.35,
  nutrition: 0.45,
  steps: 0.20,
};

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const LBS_TO_KG = 1 / 2.205;
const DEFAULT_FAT_PERCENT = 25;
const MIN_HIGH_CONFIDENCE_DAYS = 3;
const BMR_CLAMP_FACTOR = 0.3;

export class CalorieReconciliationService {
  static computeSeedBmr(weightLbs, fatPercent) {
    if (!weightLbs) return null;
    const fat = fatPercent ?? DEFAULT_FAT_PERCENT;
    const leanMassKg = weightLbs * (1 - fat / 100) * LBS_TO_KG;
    return Math.floor(370 + 21.6 * leanMassKg);
  }

  static deriveRollingBmr(dailyRecords, seedBmr) {
    const highConfDays = dailyRecords.filter(
      d => d.confidence >= HIGH_CONFIDENCE_THRESHOLD && d.solvedBmr != null
    );

    if (highConfDays.length < MIN_HIGH_CONFIDENCE_DAYS) {
      return { derivedBmr: seedBmr, highConfidenceDayCount: highConfDays.length };
    }

    const avgBmr = Math.round(
      highConfDays.reduce((sum, d) => sum + d.solvedBmr, 0) / highConfDays.length
    );

    const lower = Math.round(seedBmr * (1 - BMR_CLAMP_FACTOR));
    const upper = Math.round(seedBmr * (1 + BMR_CLAMP_FACTOR));
    const clampedBmr = Math.max(lower, Math.min(upper, avgBmr));

    return { derivedBmr: clampedBmr, highConfidenceDayCount: highConfDays.length };
  }

  static reconcile(windowData, seedBmr) {
    if (!windowData?.length || !seedBmr) return [];

    // Step 1: Interpolate missing NEAT values
    const interpolated = CalorieReconciliationService.#interpolateNeat(windowData);

    // Step 2: First pass — compute per-day with seed BMR to solve for BMR on high-confidence days
    const firstPass = interpolated.map(day => {
      const confidence = CalorieReconciliationService.computeConfidence({
        hasWeight: day.hasWeight,
        hasNutrition: day.hasNutrition,
        hasSteps: day.hasSteps,
      });

      // Solve BMR on high-confidence days: bmr = tracked - (weightDelta * 3500) - exercise - neat
      const solvedBmr = confidence >= HIGH_CONFIDENCE_THRESHOLD
        ? Math.round(day.trackedCalories - (day.weightDelta * CALORIES_PER_LB) - day.exerciseCalories - day.neatCalories)
        : null;

      return { ...day, confidence, solvedBmr };
    });

    // Step 3: Derive rolling BMR from high-confidence days
    const { derivedBmr } = CalorieReconciliationService.deriveRollingBmr(firstPass, seedBmr);

    // Step 4: Compute window averages
    const totalNeat = interpolated.reduce((s, d) => s + (d.neatCalories || 0), 0);
    const totalExercise = interpolated.reduce((s, d) => s + (d.exerciseCalories || 0), 0);
    const avgNeat = Math.round(totalNeat / interpolated.length);
    const avgExercise = Math.round(totalExercise / interpolated.length);
    const maintenanceCalories = derivedBmr + avgNeat + avgExercise;

    // Step 5: Second pass — recompute with derived BMR
    const records = interpolated.map(day => {
      const confidence = CalorieReconciliationService.computeConfidence({
        hasWeight: day.hasWeight,
        hasNutrition: day.hasNutrition,
        hasSteps: day.hasSteps,
      });

      const impliedIntake = Math.round(
        (day.weightDelta * CALORIES_PER_LB) + derivedBmr + day.exerciseCalories + day.neatCalories
      );

      const calorieAdjustment = impliedIntake - day.trackedCalories;

      let trackingAccuracy = null;
      if (impliedIntake > 0) {
        trackingAccuracy = parseFloat(Math.min(1, day.trackedCalories / impliedIntake).toFixed(2));
      }

      return {
        date: day.date,
        weight_delta_lbs: day.weightDelta,
        tracked_calories: day.trackedCalories,
        exercise_calories: day.exerciseCalories,
        neat_calories: day.neatCalories,
        seed_bmr: seedBmr,
        implied_intake: impliedIntake,
        calorie_adjustment: calorieAdjustment,
        tracking_accuracy: trackingAccuracy,
        tracking_confidence: confidence,
        derived_bmr: derivedBmr,
        maintenance_calories: maintenanceCalories,
      };
    });

    // Compute window-wide avg_tracking_accuracy (same value on every record)
    const accuracies = records.map(r => r.tracking_accuracy).filter(a => a != null);
    const avgTrackingAccuracy = accuracies.length > 0
      ? parseFloat((accuracies.reduce((s, a) => s + a, 0) / accuracies.length).toFixed(2))
      : null;

    return records.map(r => ({ ...r, avg_tracking_accuracy: avgTrackingAccuracy }));
  }

  static #interpolateNeat(windowData) {
    return windowData.map((day, i) => {
      if (day.neatCalories != null) return { ...day };

      const prev = windowData.slice(0, i).reverse().find(d => d.neatCalories != null);
      const next = windowData.slice(i + 1).find(d => d.neatCalories != null);

      let interpolated = 0;
      if (prev && next) interpolated = Math.round((prev.neatCalories + next.neatCalories) / 2);
      else if (prev) interpolated = prev.neatCalories;
      else if (next) interpolated = next.neatCalories;

      return { ...day, neatCalories: interpolated };
    });
  }

  static computeConfidence({ hasWeight, hasNutrition, hasSteps }) {
    let score = 0;
    if (hasWeight) score += CONFIDENCE_WEIGHTS.weight;
    if (hasNutrition) score += CONFIDENCE_WEIGHTS.nutrition;
    if (hasSteps) score += CONFIDENCE_WEIGHTS.steps;
    return parseFloat(score.toFixed(2));
  }
}

export default CalorieReconciliationService;
