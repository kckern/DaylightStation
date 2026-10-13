const MIN_DENOMINATOR = 0.1;
const DEFAULT_MACRO_SPLIT = { proteinRatio: 0.30, carbsRatio: 0.40, fatRatio: 0.30 };

export class CalorieAdjustmentService {
  static computeWindowStats(reconciliationRecords) {
    const valid = reconciliationRecords.filter(r => r.tracking_accuracy != null);
    if (valid.length === 0) return { avgAccuracy: null, stdDevAccuracy: null };
    const avg = valid.reduce((s, r) => s + r.tracking_accuracy, 0) / valid.length;
    if (valid.length < 3) return { avgAccuracy: parseFloat(avg.toFixed(4)), stdDevAccuracy: null };
    const variance = valid.reduce((s, r) => s + Math.pow(r.tracking_accuracy - avg, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);
    return { avgAccuracy: parseFloat(avg.toFixed(4)), stdDevAccuracy: parseFloat(stdDev.toFixed(4)) };
  }

  static computePortionMultiplier(trackingAccuracy, avgAccuracy, stdDevAccuracy) {
    if (trackingAccuracy >= 1.0) return { multiplier: 1.0, maxMultiplier: 1.0, phantomNeeded: false };
    const denominator = stdDevAccuracy != null
      ? Math.max(MIN_DENOMINATOR, avgAccuracy - stdDevAccuracy)
      : Math.max(MIN_DENOMINATOR, avgAccuracy);
    const maxMultiplier = parseFloat((1 / denominator).toFixed(2));
    const rawMultiplier = 1 / trackingAccuracy;
    const multiplier = parseFloat(Math.min(rawMultiplier, maxMultiplier).toFixed(2));
    const phantomNeeded = rawMultiplier > maxMultiplier;
    return { multiplier, maxMultiplier, phantomNeeded };
  }

  static adjustDayItems(nutrilistItems, multiplier) {
    if (!nutrilistItems?.length || multiplier === 1.0) return nutrilistItems;
    return nutrilistItems.map(item => {
      const scaled = { ...item };
      scaled.original_grams = item.grams;
      scaled.grams = Math.round(item.grams * multiplier);
      scaled.calories = Math.round((item.calories || 0) * multiplier);
      scaled.protein = Math.round((item.protein || 0) * multiplier);
      scaled.carbs = Math.round((item.carbs || 0) * multiplier);
      scaled.fat = Math.round((item.fat || 0) * multiplier);
      scaled.fiber = Math.round((item.fiber || 0) * multiplier);
      scaled.sugar = Math.round((item.sugar || 0) * multiplier);
      scaled.sodium = Math.round((item.sodium || 0) * multiplier);
      scaled.cholesterol = Math.round((item.cholesterol || 0) * multiplier);
      scaled.adjusted = true;
      return scaled;
    });
  }

  static computePhantomEntry(gapCalories, macroRatios) {
    if (!gapCalories || gapCalories <= 0) return null;
    const ratios = macroRatios || DEFAULT_MACRO_SPLIT;
    return {
      label: 'Estimated Untracked Intake',
      calories: Math.round(gapCalories),
      protein: Math.round((gapCalories * ratios.proteinRatio) / 4),
      carbs: Math.round((gapCalories * ratios.carbsRatio) / 4),
      fat: Math.round((gapCalories * ratios.fatRatio) / 9),
      phantom: true,
    };
  }

  static adjustDay(nutrilistItems, reconciliation, windowStats) {
    if (reconciliation.tracking_accuracy == null) return null;

    const { multiplier, maxMultiplier, phantomNeeded } = CalorieAdjustmentService.computePortionMultiplier(
      reconciliation.tracking_accuracy,
      windowStats.avgAccuracy,
      windowStats.stdDevAccuracy
    );

    const adjustedItems = CalorieAdjustmentService.adjustDayItems(nutrilistItems, multiplier);

    let phantomEntry = null;
    if (phantomNeeded || (nutrilistItems.length === 0 && reconciliation.implied_intake > 0)) {
      const scaledCalories = reconciliation.tracked_calories * multiplier;
      const gapCalories = reconciliation.implied_intake - scaledCalories;

      const totalCal = nutrilistItems.reduce((s, i) => s + (i.calories || 0), 0);
      const macroRatios = totalCal > 0
        ? {
            proteinRatio: nutrilistItems.reduce((s, i) => s + (i.protein || 0) * 4, 0) / totalCal,
            carbsRatio: nutrilistItems.reduce((s, i) => s + (i.carbs || 0) * 4, 0) / totalCal,
            fatRatio: nutrilistItems.reduce((s, i) => s + (i.fat || 0) * 9, 0) / totalCal,
          }
        : null;

      phantomEntry = CalorieAdjustmentService.computePhantomEntry(gapCalories, macroRatios);
    }

    return {
      adjustedItems,
      phantomEntry,
      metadata: {
        portion_multiplier: multiplier,
        max_multiplier: maxMultiplier,
        phantom_calories: phantomEntry?.calories || 0,
        raw_calories: reconciliation.tracked_calories,
        tracking_accuracy: reconciliation.tracking_accuracy,
      },
    };
  }
}

export default CalorieAdjustmentService;
