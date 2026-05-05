// backend/src/2_domains/health/services/MetricRegistry.mjs

/**
 * Per-metric reader table. Each entry says where the metric lives in the
 * underlying datastore, how to extract a value from one row, and what kind
 * of aggregation makes sense by default.
 *
 * Sources:
 *   'weight'    — entries from healthStore.loadWeightData(userId)[date]
 *   'nutrition' — entries from healthStore.loadNutritionData(userId)[date]
 *   'workouts'  — array of workouts from healthService.getHealthForRange(...)[date].workouts
 *
 * Kinds:
 *   'value' — numeric daily value (weight, fat%); aggregated as mean by default
 *   'count' — read returns the count from a workout array; aggregated as sum
 *   'sum'   — read returns a per-day sum from a workout array; aggregated as sum
 *   'ratio' — read returns 0 or 1; aggregated as count(1) / daysInPeriod
 */

const REGISTRY = Object.freeze({
  // ---------- weight (per-day numeric) ----------
  weight_lbs: {
    source: 'weight',
    unit: 'lbs',
    kind: 'value',
    read: (entry) => entry?.lbs_adjusted_average ?? entry?.lbs ?? null,
  },
  fat_percent: {
    source: 'weight',
    unit: '%',
    kind: 'value',
    read: (entry) => entry?.fat_percent_average ?? entry?.fat_percent ?? null,
  },

  // ---------- nutrition (per-day numeric) ----------
  calories:  { source: 'nutrition', unit: 'kcal', kind: 'value', read: (e) => e?.calories ?? null },
  protein_g: { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.protein  ?? null },
  carbs_g:   { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.carbs    ?? null },
  fat_g:     { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.fat      ?? null },
  fiber_g:   { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.fiber    ?? null },

  // ---------- workouts (per-day rollups) ----------
  workout_count: {
    source: 'workouts',
    unit: 'workouts',
    kind: 'count',
    read: (workouts) => Array.isArray(workouts) ? workouts.length : 0,
  },
  workout_duration_min: {
    source: 'workouts',
    unit: 'min',
    kind: 'sum',
    read: (workouts) => Array.isArray(workouts)
      ? workouts.reduce((s, w) => s + (typeof w?.duration === 'number' ? w.duration : 0), 0)
      : 0,
  },
  workout_calories: {
    source: 'workouts',
    unit: 'kcal',
    kind: 'sum',
    read: (workouts) => Array.isArray(workouts)
      ? workouts.reduce((s, w) => s + (typeof w?.calories === 'number' ? w.calories : 0), 0)
      : 0,
  },

  // ---------- density (presence-only) ----------
  tracking_density: {
    source: 'nutrition',
    unit: 'ratio',
    kind: 'ratio',
    // 1 when nutrition was logged that day (calories > 0), 0 otherwise.
    read: (entry) => (entry && typeof entry.calories === 'number' && entry.calories > 0) ? 1 : 0,
  },
});

export const MetricRegistry = Object.freeze({
  get(name) {
    const entry = REGISTRY[name];
    if (!entry) throw new Error(`MetricRegistry: unknown metric "${name}"`);
    return entry;
  },
  list() {
    return Object.keys(REGISTRY);
  },
});

export default MetricRegistry;
