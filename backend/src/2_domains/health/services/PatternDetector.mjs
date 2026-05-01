/**
 * PatternDetector (F-004)
 *
 * Pure-domain service. Given 30-day windows of nutrition, weight, workouts,
 * and compliance — plus a playbook entry list with detection thresholds — emits
 * an array of detected patterns with confidence, evidence, recommendation,
 * memoryKey, and severity.
 *
 * Stateless. No I/O, no fs, no network. Class wrapper exists for DI consistency
 * with sibling services (SimilarPeriodFinder, WeightProcessor) and to allow
 * injection of a structured logger.
 *
 * Confidence model (v1):
 *   Each signal is scored by its margin from the threshold (in the matching
 *   direction). Margin >= MARGIN_FOR_FULL (50%) → 1.0; margin = 0 (just barely
 *   matching) → 0; linearly interpolated. Pattern confidence is the minimum
 *   across all required signals (logical AND semantics). Detections only fire
 *   when every required signal matches — sub-confidence < 1.0 just means the
 *   pattern is borderline, not yet absent.
 *
 * @module domains/health/services/PatternDetector
 */

const BREAKFAST_CUTOFF_HOUR = 11; // first food >= 11:00 → "skipped breakfast"

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
   * @param {object} [args.userGoals] { calories_min, calories_max, protein_min, ... }
   * @returns {Array<object>} array of detection records
   */
  detect({ windows, playbookPatterns = [], userGoals = {} } = {}) {
    if (!windows || !Array.isArray(playbookPatterns) || playbookPatterns.length === 0) return [];

    const detections = [];
    for (const playbookEntry of playbookPatterns) {
      const detection = this.#evaluate(playbookEntry, windows, userGoals);
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

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  #evaluate(playbookEntry, windows, userGoals) {
    const dispatch = {
      'cut-mode': this.#detectCutMode,
      'if-trap-risk': this.#detectIfTrap,
      'same-jog-rut': this.#detectJogRut,
      'bike-commute-trap': this.#detectBikeTrap,
      'maintenance-drift': this.#detectMaintenanceDrift,
      'on-protocol-tracked-cut': this.#detectTrackedCut,
      'tracked-cut-formula': this.#detectTrackedCut, // alias for fixture playbook name
      'on-protocol-coached-bulk': this.#detectCoachedBulk,
    };
    const fn = dispatch[playbookEntry.name];
    if (!fn) {
      this.logger.warn?.('pattern_detector.unknown_pattern', { name: playbookEntry.name });
      return null;
    }
    return fn.call(this, playbookEntry, windows, userGoals);
  }

  // ---------------------------------------------------------------------------
  // Per-pattern detection
  // ---------------------------------------------------------------------------

  #detectJogRut(entry, windows /* , _goals */) {
    const detection = entry.detection || {};
    const windowRuns = detection.window_runs ?? 5;
    const paceThresh = detection.pace_stdev_seconds_lt ?? 60;
    const hrThresh = detection.hr_stdev_bpm_lt ?? 3;

    const runs = (windows.workouts || [])
      .filter((w) => w?.type === 'run')
      .slice(-windowRuns);

    if (runs.length < windowRuns) return null;

    const paces = runs
      .map((r) => firstNumber(r.pace_seconds_per_km, r.pace, r.average_pace))
      .filter((v) => Number.isFinite(v));
    const hrs = runs
      .map((r) => firstNumber(r.average_hr, r.heart_rate, r.hr))
      .filter((v) => Number.isFinite(v));

    if (paces.length < windowRuns || hrs.length < windowRuns) return null;

    const paceStdev = stdev(paces);
    const hrStdev = stdev(hrs);

    if (!(paceStdev < paceThresh && hrStdev < hrThresh)) return null;

    const confidence = Math.min(
      confidenceBelow(paceStdev, paceThresh),
      confidenceBelow(hrStdev, hrThresh),
    );

    return buildDetection(entry, {
      pace_stdev_seconds: round(paceStdev, 2),
      hr_stdev_bpm: round(hrStdev, 2),
      window_runs: runs.length,
    }, confidence);
  }

  #detectIfTrap(entry, windows /* , _goals */) {
    const detection = entry.detection || {};
    const proteinThresh = detection.protein_avg_lt_g ?? 100;
    const breakfastThresh = detection.breakfast_skipped_days_7d_gt ?? 4;

    const last7 = (windows.nutrition || []).slice(-7);
    if (last7.length === 0) return null;

    const proteinAvg = mean(last7.map((d) => Number(d.protein) || 0));
    const skippedDays = countSkippedBreakfastDays(last7);

    const passProtein = proteinAvg < proteinThresh;
    const passBreakfast = skippedDays > breakfastThresh;
    if (!(passProtein && passBreakfast)) return null;

    const confidence = Math.min(
      confidenceBelow(proteinAvg, proteinThresh),
      confidenceExceeded(skippedDays, breakfastThresh),
    );

    return buildDetection(entry, {
      protein_avg_g: round(proteinAvg, 1),
      breakfast_skipped_days_7d: skippedDays,
    }, confidence);
  }

  #detectMaintenanceDrift(entry, windows /* , _goals */) {
    const detection = entry.detection || {};
    const trackingThresh = detection.tracking_rate_14d_lt ?? 0.5;
    const weightThresh = detection.weight_trend_3w_gt_lbs ?? 1.0;
    const proteinDropThresh = detection.protein_avg_drop_pct_gt ?? 0.15;

    const trackingRate = readTrackingRate14d(windows);
    if (trackingRate === null) return null;
    const weightTrend = weightDeltaOverDays(windows.weight, 21);
    if (weightTrend === null) return null;
    const proteinDrop = proteinDropPct(windows.nutrition);
    if (proteinDrop === null) return null;

    const passTracking = trackingRate < trackingThresh;
    const passWeight = weightTrend > weightThresh;
    const passProtein = proteinDrop > proteinDropThresh;
    if (!(passTracking && passWeight && passProtein)) return null;

    const confidence = Math.min(
      confidenceBelow(trackingRate, trackingThresh),
      confidenceExceeded(weightTrend, weightThresh),
      confidenceExceeded(proteinDrop, proteinDropThresh),
    );

    return buildDetection(entry, {
      tracking_rate_14d: round(trackingRate, 3),
      weight_trend_3w_lbs: round(weightTrend, 2),
      protein_avg_drop_pct: round(proteinDrop, 3),
    }, confidence);
  }

  #detectTrackedCut(entry, windows /* , _goals */) {
    const detection = entry.detection || {};
    const proteinThresh = detection.protein_avg_gt_g ?? 140;
    const trackingThresh = detection.tracking_rate_14d_gt ?? 0.9;
    const repetitionThresh = detection.meal_repetition_index_gt ?? 0.6;

    const last14 = (windows.nutrition || []).slice(-14);
    if (last14.length === 0) return null;

    const proteinAvg = mean(last14.map((d) => Number(d.protein) || 0));
    const trackingRate = readTrackingRate14d(windows);
    if (trackingRate === null) return null;
    const repetitionIndex = mealRepetitionIndex(last14);

    const passProtein = proteinAvg > proteinThresh;
    const passTracking = trackingRate > trackingThresh;
    const passRepetition = repetitionIndex > repetitionThresh;
    if (!(passProtein && passTracking && passRepetition)) return null;

    const confidence = Math.min(
      confidenceExceeded(proteinAvg, proteinThresh),
      confidenceExceeded(trackingRate, trackingThresh),
      confidenceExceeded(repetitionIndex, repetitionThresh),
    );

    return buildDetection(entry, {
      protein_avg_g: round(proteinAvg, 1),
      tracking_rate_14d: round(trackingRate, 3),
      meal_repetition_index: round(repetitionIndex, 3),
    }, confidence);
  }

  #detectCutMode(entry, windows, goals) {
    const detection = entry.detection || {};
    const proteinThresh = detection.protein_avg_gt_g ?? goals.protein_min ?? 140;
    const calorieMax = detection.calorie_avg_lt ?? goals.calories_max ?? 2100;
    const weightDeltaThresh = detection.weight_delta_14d_lt_lbs ?? -1;

    const last14 = (windows.nutrition || []).slice(-14);
    if (last14.length === 0) return null;
    const proteinAvg = mean(last14.map((d) => Number(d.protein) || 0));
    const calorieAvg = mean(last14.map((d) => Number(d.calories) || 0));
    const weightDelta = weightDeltaOverDays(windows.weight, 14);
    if (weightDelta === null) return null;

    const passProtein = proteinAvg >= proteinThresh;
    const passCalories = calorieAvg <= calorieMax;
    const passWeight = weightDelta <= weightDeltaThresh;
    if (!(passProtein && passCalories && passWeight)) return null;

    // Confidence: each signal scored by margin against its threshold.
    const confidence = Math.min(
      confidenceExceeded(proteinAvg, proteinThresh),
      confidenceBelow(calorieAvg, calorieMax),
      // weightDelta and weightDeltaThresh are both negative; "stronger cut" = more
      // negative weightDelta. Compare absolute values via confidenceExceeded.
      confidenceExceeded(Math.abs(weightDelta), Math.abs(weightDeltaThresh || 1)),
    );

    return buildDetection(entry, {
      protein_avg_g: round(proteinAvg, 1),
      calorie_avg: round(calorieAvg, 0),
      weight_delta_14d_lbs: round(weightDelta, 2),
    }, confidence);
  }

  #detectBikeTrap(entry, windows /* , _goals */) {
    const detection = entry.detection || {};
    const bikeThresh = detection.bike_workouts_30d_gt ?? 5;
    const trackingThresh = detection.tracking_rate_lt ?? 0.7;
    const weightThresh = detection.weight_delta_lbs_gt ?? 1;

    const bikeCount = (windows.workouts || [])
      .filter((w) => isBikeWorkout(w))
      .length;
    const trackingRate = readTrackingRate14d(windows);
    if (trackingRate === null) return null;
    const weightDelta = weightDeltaOverDays(windows.weight, 21);
    if (weightDelta === null) return null;

    const passBike = bikeCount >= bikeThresh;
    const passTracking = trackingRate < trackingThresh;
    const passWeight = weightDelta > weightThresh;
    if (!(passBike && passTracking && passWeight)) return null;

    const confidence = Math.min(
      Math.min(1, bikeCount / bikeThresh),
      confidenceBelow(trackingRate, trackingThresh),
      confidenceExceeded(weightDelta, weightThresh),
    );

    return buildDetection(entry, {
      bike_workouts_30d: bikeCount,
      tracking_rate: round(trackingRate, 3),
      weight_delta_lbs: round(weightDelta, 2),
    }, confidence);
  }

  #detectCoachedBulk(entry, windows, goals) {
    const detection = entry.detection || {};
    const proteinMin = detection.protein_avg_gt_g ?? goals.protein_min ?? 140;
    const calorieMax = goals.calories_max ?? 2100;

    const programPresent = (windows.workouts || []).some((w) => isProgrammedWorkout(w));
    if (!programPresent) return null;

    const last14 = (windows.nutrition || []).slice(-14);
    if (last14.length === 0) return null;
    const proteinAvg = mean(last14.map((d) => Number(d.protein) || 0));
    const calorieAvg = mean(last14.map((d) => Number(d.calories) || 0));

    const passProtein = proteinAvg >= proteinMin;
    const passSurplus = calorieAvg > calorieMax;
    if (!(passProtein && passSurplus)) return null;

    const confidence = Math.min(
      confidenceExceeded(proteinAvg, proteinMin),
      Math.min(1, (calorieAvg - calorieMax) / Math.max(calorieMax * 0.1, 1)),
    );

    return buildDetection(entry, {
      program_present: true,
      calorie_avg: round(calorieAvg, 0),
      protein_avg_g: round(proteinAvg, 1),
    }, confidence);
  }
}

// ---------------------------------------------------------------------------
// Module-scope helpers (kept private to this file; not exported for testing —
// public API surface is the `detect()` method).
// ---------------------------------------------------------------------------

function buildDetection(entry, evidence, confidence) {
  return {
    name: entry.name,
    type: entry.type,
    confidence: clamp01(confidence),
    evidence,
    recommendation: entry.recommended_response || entry.recommendation || '',
    memoryKey: `pattern_${entry.name}_last_flagged`,
    severity: entry.severity || 'medium',
  };
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

// Confidence model parameters. The "margin" is the fractional distance from
// the threshold in the matching direction. Margin >= MARGIN_FOR_FULL → 1.0;
// margin = 0 (just barely matching) → 0; linearly interpolated between.
const MARGIN_FOR_FULL = 0.5;

/**
 * Confidence when signal is required to EXCEED a threshold.
 * margin = (signal - threshold) / threshold.
 * Far above → 1.0; just barely above → ~0.
 */
function confidenceExceeded(signal, threshold) {
  if (!Number.isFinite(signal) || !Number.isFinite(threshold) || threshold === 0) return 0;
  const margin = (signal - threshold) / threshold;
  return clamp01(margin / MARGIN_FOR_FULL);
}

/**
 * Confidence when signal is required to be BELOW a threshold.
 * margin = (threshold - signal) / threshold.
 * Far below → 1.0; just barely below → ~0.
 */
function confidenceBelow(signal, threshold) {
  if (!Number.isFinite(signal) || !Number.isFinite(threshold) || threshold === 0) return 0;
  const margin = (threshold - signal) / threshold;
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
    if (items.length === 0) continue; // no food at all = nothing to evaluate
    const timestamps = items
      .map((it) => parseHour(it?.timestamp))
      .filter((h) => Number.isFinite(h))
      .sort((a, b) => a - b);
    if (timestamps.length === 0) continue; // no timestamp data → don't count
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
 * window. Returns the fractional drop ((earlier - recent) / earlier), or
 * null if insufficient data. Negative means protein actually rose.
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
 * meal_repetition_index — fraction of days where ≥3 of the top-most-common
 * food names (across the window) appear. Substring-insensitive name match.
 */
function mealRepetitionIndex(nutritionDays) {
  if (!Array.isArray(nutritionDays) || nutritionDays.length === 0) return 0;
  // Tally each food name across the window.
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
  // Top 3 most-common foods.
  const top3 = Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  if (top3.length === 0) return 0;
  // Fraction of days containing all top-3 (or as many as exist).
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
  // Fallback heuristic: name references known programs.
  const name = String(w.name || '').toLowerCase();
  return /(stronglifts|5x5|wendler|531|gzclp|smolov|starting strength)/i.test(name);
}

export default PatternDetector;
