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

  static computeConfidence({ hasWeight, hasNutrition, hasSteps }) {
    let score = 0;
    if (hasWeight) score += CONFIDENCE_WEIGHTS.weight;
    if (hasNutrition) score += CONFIDENCE_WEIGHTS.nutrition;
    if (hasSteps) score += CONFIDENCE_WEIGHTS.steps;
    return parseFloat(score.toFixed(2));
  }
}

export default CalorieReconciliationService;
