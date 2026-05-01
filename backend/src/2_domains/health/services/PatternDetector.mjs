/**
 * PatternDetector (F-004 — F1-A primitive-driven refactor)
 *
 * Pure-domain service. Patterns are NOT hardcoded here. Each playbook entry
 * declares a `detection` block whose keys are PRIMITIVE names registered
 * in this file (e.g. `pace_stdev_seconds_lt`, `protein_avg_lt_g`). The
 * detector evaluates every primitive declared on the entry and AND-combines
 * them; if all match, the detection fires with confidence = min margin
 * across all primitive checks.
 *
 * The boundary the audit (F1-A) draws:
 *   - Code: primitive shape, computation, schema (this file).
 *   - YAML: pattern names, threshold values, primitive composition.
 *
 * A future playbook pattern named "weekend-binge" or "winter-tracking-collapse"
 * ships as a YAML edit, not a code change.
 *
 * Confidence model (v1):
 *   For each primitive, margin = |threshold - signal| / |threshold|, clamped
 *   into [0, MARGIN_FOR_FULL]; confidence-component = margin / MARGIN_FOR_FULL.
 *   Pattern confidence = min across components (logical AND).
 *
 * Stateless. No I/O, no fs, no network.
 *
 * @module domains/health/services/PatternDetector
 */

const BREAKFAST_CUTOFF_HOUR = 11; // first food >= 11:00 → "skipped breakfast"

// Confidence model parameters. Margin >= MARGIN_FOR_FULL (50%) → 1.0;
// margin = 0 (just barely matching) → 0; linearly interpolated between.
const MARGIN_FOR_FULL = 0.5;

// Detection-block keys that are metadata for primitives (window sizes), not
// primitive checks themselves. Skipped during evaluation.
const METADATA_KEYS = new Set(['window_runs', 'weight_delta_window_days']);

// ---------------------------------------------------------------------------
// PRIMITIVES
//
// Each primitive: (windows, threshold, entry) → result | null.
//   - returns null when there is not enough data to evaluate
//   - returns { match, signal, evidenceKey, evidenceValue } otherwise
//
// Primitive names match the keys declared in playbook YAML `detection` blocks.
// Names ending in `_lt` test signal < threshold; `_gt` test signal > threshold.
// Special primitives (e.g. `programmed_workout_present`) document their own
// shape inline.
// ---------------------------------------------------------------------------

const PRIMITIVES = {
  // --- Workout primitives (run shape) ---
  pace_stdev_seconds_lt: (windows, threshold, entry) => {
    const windowRuns = entry.detection?.window_runs;
    if (!Number.isFinite(windowRuns)) return null;
    const runs = (windows.workouts || [])
      .filter((w) => w?.type === 'run')
      .slice(-windowRuns);
    if (runs.length < windowRuns) return null;
    const paces = runs
      .map((r) => firstNumber(r.pace_seconds_per_km, r.pace, r.average_pace))
      .filter((v) => Number.isFinite(v));
    if (paces.length < windowRuns) return null;
    const value = stdev(paces);
    return matchLt(value, threshold, 'pace_stdev_seconds', round(value, 2));
  },

  hr_stdev_bpm_lt: (windows, threshold, entry) => {
    const windowRuns = entry.detection?.window_runs;
    if (!Number.isFinite(windowRuns)) return null;
    const runs = (windows.workouts || [])
      .filter((w) => w?.type === 'run')
      .slice(-windowRuns);
    if (runs.length < windowRuns) return null;
    const hrs = runs
      .map((r) => firstNumber(r.average_hr, r.heart_rate, r.hr))
      .filter((v) => Number.isFinite(v));
    if (hrs.length < windowRuns) return null;
    const value = stdev(hrs);
    return matchLt(value, threshold, 'hr_stdev_bpm', round(value, 2));
  },

  // --- Workout count primitives ---
  bike_workouts_30d_gt: (windows, threshold) => {
    const value = (windows.workouts || []).filter(isBikeWorkout).length;
    return matchGt(value, threshold, 'bike_workouts_30d', value);
  },

  // --- Programmed workout presence (boolean shape) ---
  // Threshold can be true/false; we only fire when threshold is truthy AND a
  // programmed workout is present. If the playbook author wanted "no program"
  // they would write `programmed_workout_absent` (not currently registered).
  programmed_workout_present: (windows, threshold) => {
    const present = (windows.workouts || []).some(isProgrammedWorkout);
    const want = Boolean(threshold);
    const match = want ? present : !present;
    return {
      match,
      signal: present ? 1 : 0,
      evidenceKey: 'programmed_workout_present',
      evidenceValue: present,
      // Boolean primitives are full-confidence on match (no margin to compute).
      booleanFullConfidence: true,
    };
  },

  // --- Nutrition primitives ---
  protein_avg_lt_g: (windows, threshold) => {
    const last = nutritionTail(windows, 7);
    if (!last.length) return null;
    const value = mean(last.map((d) => Number(d.protein) || 0));
    return matchLt(value, threshold, 'protein_avg_g', round(value, 1));
  },

  protein_avg_gt_g: (windows, threshold) => {
    const last = nutritionTail(windows, 14);
    if (!last.length) return null;
    const value = mean(last.map((d) => Number(d.protein) || 0));
    return matchGt(value, threshold, 'protein_avg_g', round(value, 1));
  },

  calorie_avg_lt: (windows, threshold) => {
    const last = nutritionTail(windows, 14);
    if (!last.length) return null;
    const value = mean(last.map((d) => Number(d.calories) || 0));
    return matchLt(value, threshold, 'calorie_avg', round(value, 0));
  },

  calorie_avg_gt: (windows, threshold) => {
    const last = nutritionTail(windows, 14);
    if (!last.length) return null;
    const value = mean(last.map((d) => Number(d.calories) || 0));
    return matchGt(value, threshold, 'calorie_avg', round(value, 0));
  },

  protein_avg_drop_pct_gt: (windows, threshold) => {
    const value = proteinDropPct(windows.nutrition);
    if (value === null) return null;
    return matchGt(value, threshold, 'protein_avg_drop_pct', round(value, 3));
  },

  breakfast_skipped_days_7d_gt: (windows, threshold) => {
    const last7 = (windows.nutrition || []).slice(-7);
    if (!last7.length) return null;
    const value = countSkippedBreakfastDays(last7);
    return matchGt(value, threshold, 'breakfast_skipped_days_7d', value);
  },

  meal_repetition_index_gt: (windows, threshold) => {
    const last14 = (windows.nutrition || []).slice(-14);
    if (!last14.length) return null;
    const value = mealRepetitionIndex(last14);
    return matchGt(value, threshold, 'meal_repetition_index', round(value, 3));
  },

  // --- Compliance primitives ---
  tracking_rate_14d_lt: (windows, threshold) => {
    const value = readTrackingRate14d(windows);
    if (value === null) return null;
    return matchLt(value, threshold, 'tracking_rate_14d', round(value, 3));
  },

  tracking_rate_14d_gt: (windows, threshold) => {
    const value = readTrackingRate14d(windows);
    if (value === null) return null;
    return matchGt(value, threshold, 'tracking_rate_14d', round(value, 3));
  },

  // --- Weight primitives ---
  weight_trend_3w_gt_lbs: (windows, threshold) => {
    const value = weightDeltaOverDays(windows.weight, 21);
    if (value === null) return null;
    return matchGt(value, threshold, 'weight_trend_3w_lbs', round(value, 2));
  },

  weight_trend_3w_lt_lbs: (windows, threshold) => {
    const value = weightDeltaOverDays(windows.weight, 21);
    if (value === null) return null;
    return matchLt(value, threshold, 'weight_trend_3w_lbs', round(value, 2));
  },

  weight_delta_lt_lbs: (windows, threshold, entry) => {
    const days = entry.detection?.weight_delta_window_days;
    if (!Number.isFinite(days)) return null;
    const value = weightDeltaOverDays(windows.weight, days);
    if (value === null) return null;
    return matchLt(value, threshold, 'weight_delta_lbs', round(value, 2));
  },

  weight_delta_gt_lbs: (windows, threshold, entry) => {
    const days = entry.detection?.weight_delta_window_days;
    if (!Number.isFinite(days)) return null;
    const value = weightDeltaOverDays(windows.weight, days);
    if (value === null) return null;
    return matchGt(value, threshold, 'weight_delta_lbs', round(value, 2));
  },
};

// ---------------------------------------------------------------------------
// PatternDetector
// ---------------------------------------------------------------------------

export class PatternDetector {
  /**
   * @param {object} [opts]
   * @param {object} [opts.logger] structured logger; falls back to console
   */
  constructor({ logger } = {}) {
    this.logger = logger || console;
  }

  /**
   * Detect patterns from windows + playbook entries.
   *
   * @param {object} args
   * @param {object} args.windows { nutrition, weight, workouts, compliance }
   * @param {Array<object>} args.playbookPatterns playbook entries with detection thresholds
   * @param {object} [args.userGoals] reserved for future per-user thresholds (unused in v1)
   * @returns {Array<object>} array of detection records
   */
  // eslint-disable-next-line no-unused-vars
  detect({ windows, playbookPatterns = [], userGoals = {} } = {}) {
    if (!windows || !Array.isArray(playbookPatterns) || playbookPatterns.length === 0) return [];

    const detections = [];
    for (const playbookEntry of playbookPatterns) {
      const detection = this.#evaluate(playbookEntry, windows);
      if (detection) {
        detections.push(detection);
        this.logger.info?.('pattern_detector.match', {
          name: detection.name,
          confidence: detection.confidence,
        });
      }
    }
    return detections;
  }

  /**
   * Evaluate one playbook entry by composing its primitives.
   *
   * Returns null when:
   *  - the detection block is empty
   *  - any primitive is unknown (warn + skip pattern entirely)
   *  - any primitive returns null (insufficient data)
   *  - any primitive's match is false (logical AND)
   */
  #evaluate(entry, windows) {
    const detection = entry?.detection || {};
    const keys = Object.keys(detection);
    if (keys.length === 0) return null;

    const checks = [];
    for (const [key, threshold] of Object.entries(detection)) {
      if (METADATA_KEYS.has(key)) continue;
      const fn = PRIMITIVES[key];
      if (!fn) {
        this.logger.warn?.('pattern_detector.unknown_primitive', {
          name: entry.name,
          primitive: key,
        });
        return null;
      }
      const result = fn(windows, threshold, entry);
      if (result === null) return null;       // insufficient data
      if (!result.match) return null;         // AND-combine
      checks.push({ key, threshold, ...result });
    }
    if (checks.length === 0) return null;

    const confidence = scoreConfidence(checks);

    return {
      name: entry.name,
      type: entry.type,
      confidence,
      evidence: Object.fromEntries(checks.map((c) => [c.evidenceKey, c.evidenceValue])),
      recommendation: entry.recommended_response || entry.recommendation || '',
      memoryKey: `pattern_${entry.name}_last_flagged`,
      severity: entry.severity || 'medium',
    };
  }
}

export default PatternDetector;

// ---------------------------------------------------------------------------
// Module-scope helpers (private to this file).
// ---------------------------------------------------------------------------

function nutritionTail(windows, n) {
  const days = windows.nutrition;
  if (!Array.isArray(days) || days.length === 0) return [];
  return days.slice(-n);
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(n, places = 2) {
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function firstNumber(...candidates) {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Build a primitive result for an `_lt` check (signal must be below threshold).
 */
function matchLt(signal, threshold, evidenceKey, evidenceValue) {
  if (!Number.isFinite(signal) || !Number.isFinite(threshold)) return null;
  return {
    match: signal < threshold,
    signal,
    evidenceKey,
    evidenceValue,
  };
}

/**
 * Build a primitive result for a `_gt` check (signal must be above threshold).
 */
function matchGt(signal, threshold, evidenceKey, evidenceValue) {
  if (!Number.isFinite(signal) || !Number.isFinite(threshold)) return null;
  return {
    match: signal > threshold,
    signal,
    evidenceKey,
    evidenceValue,
  };
}

/**
 * Confidence per primitive check. Boolean primitives that opt into
 * `booleanFullConfidence: true` contribute 1.0. Otherwise margin is computed
 * from |threshold - signal| / |threshold|, divided by MARGIN_FOR_FULL,
 * clamped to [0, 1]. The pattern's overall confidence is the minimum across
 * checks (AND semantics).
 */
function scoreConfidence(checks) {
  if (!checks.length) return 0;
  let min = 1;
  for (const c of checks) {
    const component = checkConfidence(c);
    if (component < min) min = component;
  }
  return clamp01(min);
}

function checkConfidence(c) {
  if (c.booleanFullConfidence) return 1;
  const t = Math.abs(c.threshold);
  if (t === 0 || !Number.isFinite(t)) return 0;
  const diff = Math.abs(c.threshold - c.signal);
  const margin = diff / t;
  return clamp01(margin / MARGIN_FOR_FULL);
}

/**
 * Count days where the first food entry's timestamp is at or after
 * BREAKFAST_CUTOFF_HOUR. Days with no timestamp data on food_items are NOT
 * counted as skipped (graceful degradation per spec).
 */
function countSkippedBreakfastDays(nutritionDays) {
  let count = 0;
  for (const day of nutritionDays) {
    const items = Array.isArray(day.food_items) ? day.food_items : [];
    if (items.length === 0) continue;
    const timestamps = items
      .map((it) => parseHour(it?.timestamp))
      .filter((h) => Number.isFinite(h))
      .sort((a, b) => a - b);
    if (timestamps.length === 0) continue;
    if (timestamps[0] >= BREAKFAST_CUTOFF_HOUR) count++;
  }
  return count;
}

function parseHour(timestamp) {
  if (typeof timestamp !== 'string') return NaN;
  const m = timestamp.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) + Number(m[2]) / 60;
}

/**
 * Tracking rate over the trailing 14-day window. If `windows.compliance` has
 * an explicit `tracking_rate_14d`, use it. Otherwise derive from
 * post_workout_protein logged/missed/untracked counts. Returns null if no
 * data is available.
 */
function readTrackingRate14d(windows) {
  const c = windows.compliance || {};
  if (typeof c.tracking_rate_14d === 'number' && Number.isFinite(c.tracking_rate_14d)) {
    return c.tracking_rate_14d;
  }
  const pwp = c.post_workout_protein;
  if (pwp && typeof pwp === 'object') {
    const logged = Number(pwp.logged) || 0;
    const missed = Number(pwp.missed) || 0;
    const untracked = Number(pwp.untracked) || 0;
    const total = logged + missed + untracked;
    if (total > 0) return logged / total;
  }
  return null;
}

/**
 * Weight delta (last - first) over the trailing N days of the weight series.
 * Positive delta = gained, negative = lost. Returns null if insufficient data.
 */
function weightDeltaOverDays(weightSeries, days) {
  if (!Array.isArray(weightSeries) || weightSeries.length < 2) return null;
  const slice = weightSeries.slice(-days);
  if (slice.length < 2) return null;
  const first = Number(slice[0]?.lbs);
  const last = Number(slice[slice.length - 1]?.lbs);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return last - first;
}

/**
 * Compare protein avg of the trailing half vs. earlier half of the nutrition
 * window. Returns the fractional drop ((earlier - recent) / earlier), or null
 * if insufficient data. Negative means protein actually rose.
 */
function proteinDropPct(nutritionDays) {
  if (!Array.isArray(nutritionDays) || nutritionDays.length < 4) return null;
  const mid = Math.floor(nutritionDays.length / 2);
  const earlier = nutritionDays.slice(0, mid).map((d) => Number(d.protein) || 0);
  const recent = nutritionDays.slice(mid).map((d) => Number(d.protein) || 0);
  const earlierAvg = mean(earlier);
  const recentAvg = mean(recent);
  if (earlierAvg === 0) return null;
  return (earlierAvg - recentAvg) / earlierAvg;
}

/**
 * meal_repetition_index — fraction of days where the top-3 most-common food
 * names (across the window) all appear. Substring-insensitive name match.
 */
function mealRepetitionIndex(nutritionDays) {
  if (!Array.isArray(nutritionDays) || nutritionDays.length === 0) return 0;
  const tally = new Map();
  for (const day of nutritionDays) {
    const items = Array.isArray(day.food_items) ? day.food_items : [];
    const seenInDay = new Set();
    for (const it of items) {
      const name = String(it?.name || '').toLowerCase().trim();
      if (!name || seenInDay.has(name)) continue;
      seenInDay.add(name);
      tally.set(name, (tally.get(name) || 0) + 1);
    }
  }
  if (tally.size === 0) return 0;
  const top3 = Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  if (top3.length === 0) return 0;
  let daysWithAll = 0;
  for (const day of nutritionDays) {
    const items = Array.isArray(day.food_items) ? day.food_items : [];
    const names = new Set(items.map((it) => String(it?.name || '').toLowerCase().trim()));
    const present = top3.filter((t) => names.has(t)).length;
    if (present >= Math.min(3, top3.length)) daysWithAll++;
  }
  return daysWithAll / nutritionDays.length;
}

function isBikeWorkout(w) {
  if (!w) return false;
  const t = String(w.type || '').toLowerCase();
  return t === 'bike' || t === 'cycling' || t === 'ride';
}

function isProgrammedWorkout(w) {
  if (!w) return false;
  if (typeof w.program_name === 'string' && w.program_name.trim().length > 0) return true;
  const name = String(w.name || '').toLowerCase();
  return /(stronglifts|5x5|wendler|531|gzclp|smolov|starting strength)/i.test(name);
}
