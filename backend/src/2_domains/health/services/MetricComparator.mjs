// backend/src/2_domains/health/services/MetricComparator.mjs

import { MetricRegistry } from './MetricRegistry.mjs';

/**
 * Comparison and correlation primitives. Builds on MetricAggregator —
 * comparator constructs aggregate calls, then assembles a compressed answer.
 *
 * Reliability scoring: based on how complete the data is for each period.
 * Threshold ratios (daysCovered / daysInPeriod):
 *   >= 0.7 → high
 *   >= 0.4 → medium
 *   else  → low
 *
 * @typedef {object} MetricComparatorDeps
 * @property {object} aggregator      - MetricAggregator instance
 * @property {object} periodResolver  - PeriodResolver instance
 * @property {object} healthStore     - IHealthDataDatastore
 * @property {object} healthService   - exposes getHealthForRange()
 */
export class MetricComparator {
  constructor(deps) {
    if (!deps?.aggregator)     throw new Error('MetricComparator requires aggregator');
    if (!deps?.periodResolver) throw new Error('MetricComparator requires periodResolver');
    if (!deps?.healthStore)    throw new Error('MetricComparator requires healthStore');
    if (!deps?.healthService)  throw new Error('MetricComparator requires healthService');
    this.aggregator = deps.aggregator;
    this.periodResolver = deps.periodResolver;
    this.healthStore = deps.healthStore;
    this.healthService = deps.healthService;
  }

  /**
   * Compare a metric across two periods.
   *
   * @returns {Promise<{
   *   metric: string, statistic: string,
   *   a: { period, value, daysCovered, daysInPeriod },
   *   b: { period, value, daysCovered, daysInPeriod },
   *   delta: number|null, percentChange: number|null,
   *   reliability: 'high'|'medium'|'low'
   * }>}
   */
  async compare({ userId, metric, period_a, period_b, statistic = 'mean' }) {
    const [a, b] = await Promise.all([
      this.aggregator.aggregate({ userId, metric, period: period_a, statistic }),
      this.aggregator.aggregate({ userId, metric, period: period_b, statistic }),
    ]);

    const delta = (a.value != null && b.value != null) ? a.value - b.value : null;
    const percentChange = (delta != null && b.value !== 0 && b.value != null)
      ? delta / b.value
      : null;

    const reliability = scoreReliability(a, b);

    return {
      metric, statistic,
      a: { period: a.period, value: a.value, daysCovered: a.daysCovered, daysInPeriod: a.daysInPeriod },
      b: { period: b.period, value: b.value, daysCovered: b.daysCovered, daysInPeriod: b.daysInPeriod },
      delta, percentChange, reliability,
    };
  }

  /**
   * Richer comparison than `compare`: classifies change shape, identifies
   * inflection point, and reports per-side variance.
   *
   * @returns {Promise<{
   *   metric, statistic, a, b, delta, percentChange,
   *   changeShape: 'monotonic'|'volatile'|'step'|'reversal',
   *   inflectionDate: string|null,
   *   varianceA: number, varianceB: number,
   *   drivers: Array
   * }>}
   */
  async summarizeChange({ userId, metric, period_a, period_b, statistic = 'mean' }) {
    const cmp = await this.compare({ userId, metric, period_a, period_b, statistic });

    // Pull per-day series for both sides for variance + shape detection.
    const [seriesA, seriesB] = await Promise.all([
      this.aggregator.aggregateSeries({ userId, metric, period: period_a, granularity: 'daily', statistic }),
      this.aggregator.aggregateSeries({ userId, metric, period: period_b, granularity: 'daily', statistic }),
    ]);

    const valuesA = seriesA.buckets.map(b => b.value).filter(v => typeof v === 'number' && Number.isFinite(v));
    const valuesB = seriesB.buckets.map(b => b.value).filter(v => typeof v === 'number' && Number.isFinite(v));

    const varianceA = computeVariance(valuesA);
    const varianceB = computeVariance(valuesB);

    let changeShape;
    if (cmp.delta == null) {
      changeShape = 'step';   // can't classify with missing data
    } else {
      // Concatenate the two series chronologically (b before a, by their resolved from/to)
      const combined = [...seriesB.buckets, ...seriesA.buckets].map(b => b.value)
        .filter(v => typeof v === 'number' && Number.isFinite(v));
      changeShape = classifyShape(combined, varianceA + varianceB);
    }

    // Inflection: the daily index in the combined series with the largest
    // absolute step. We map back to the date by walking the combined series.
    const combinedBuckets = [...seriesB.buckets, ...seriesA.buckets];
    const inflectionDate = findInflectionDate(combinedBuckets);

    return {
      metric: cmp.metric,
      statistic: cmp.statistic,
      a: cmp.a,
      b: cmp.b,
      delta: cmp.delta,
      percentChange: cmp.percentChange,
      changeShape,
      inflectionDate,
      varianceA, varianceB,
      drivers: [],   // Plan 2 placeholder; future plans enrich this
    };
  }

  /**
   * Compute a metric statistic separately for days matching vs not matching
   * a condition. Returns the matched / not-matched values plus their delta.
   *
   * Conditions (Plan 2):
   *   { tracked: true|false }      — nutrition was/wasn't logged that day
   *   { workout: true|false }      — at least one workout that day
   *   { weekday: 'Mon'|'Tue'|... } — ISO day-of-week
   *   { weekend: true|false }      — Sat/Sun vs weekday
   *   { since: 'YYYY-MM-DD' }      — date >= cutoff
   *   { before: 'YYYY-MM-DD' }     — date < cutoff
   */
  async conditionalAggregate({ userId, metric, period, condition, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);
    const resolved = this.periodResolver.resolve(period);
    const dateMatcher = buildDateMatcher(condition);
    const presenceMatcher = await this.#buildPresenceMatcher(condition, userId, resolved);

    // Pull all daily values across the period.
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily', statistic,
    });

    const matching = [];
    const notMatching = [];
    for (const bucket of series.buckets) {
      const date = bucket.period;  // 'YYYY-MM-DD' for daily granularity
      const matches = dateMatcher(date) && presenceMatcher(date);
      if (matches) matching.push(bucket.value);
      else notMatching.push(bucket.value);
    }

    // Compute the requested statistic over each side.
    const matchValue = matching.length ? aggregateBucket(matching, statistic, reg.kind) : null;
    const notMatchValue = notMatching.length ? aggregateBucket(notMatching, statistic, reg.kind) : null;
    const delta = (matchValue != null && notMatchValue != null) ? matchValue - notMatchValue : null;

    return {
      metric, statistic,
      period: resolved,
      condition: { description: describeCondition(condition), ...condition },
      matching:    { value: matchValue,    daysMatched:    matching.length },
      notMatching: { value: notMatchValue, daysNotMatched: notMatching.length },
      delta,
    };
  }

  // Build a presence matcher for conditions that need to consult store data
  // (e.g. tracked/workout). Returns a sync (date) -> boolean function.
  async #buildPresenceMatcher(condition, userId, resolved) {
    if (Object.prototype.hasOwnProperty.call(condition, 'tracked')) {
      const data = await this.healthStore.loadNutritionData(userId);
      const desired = condition.tracked === true;
      return (date) => {
        const e = data?.[date];
        const tracked = !!(e && typeof e.calories === 'number' && e.calories > 0);
        return tracked === desired;
      };
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'workout')) {
      const range = await this.healthService.getHealthForRange(userId, resolved.from, resolved.to);
      const desired = condition.workout === true;
      return (date) => {
        const arr = range?.[date]?.workouts;
        const has = Array.isArray(arr) && arr.length > 0;
        return has === desired;
      };
    }
    return () => true;
  }

  /**
   * Joint behavior of two metrics over a period. Returns rank correlation
   * (Spearman) and Pearson correlation, the number of paired observations,
   * and a coarse interpretation.
   */
  async correlateMetrics({ userId, metric_a, metric_b, period, granularity = 'daily' }) {
    const resolved = this.periodResolver.resolve(period);
    const [seriesA, seriesB] = await Promise.all([
      this.aggregator.aggregateSeries({ userId, metric: metric_a, period, granularity }),
      this.aggregator.aggregateSeries({ userId, metric: metric_b, period, granularity }),
    ]);

    // Align by bucket period key.
    const indexB = new Map(seriesB.buckets.map(b => [b.period, b.value]));
    const pairs = [];
    for (const a of seriesA.buckets) {
      const bv = indexB.get(a.period);
      if (typeof a.value === 'number' && Number.isFinite(a.value)
          && typeof bv === 'number' && Number.isFinite(bv)) {
        pairs.push([a.value, bv]);
      }
    }

    const pearson = pearsonCorrelation(pairs);
    const spearman = spearmanCorrelation(pairs);
    const headline = Number.isFinite(spearman) ? spearman : 0;

    return {
      metric_a, metric_b,
      period: resolved,
      granularity,
      correlation: Number.isFinite(spearman) ? spearman : 0,
      pearson:     Number.isFinite(pearson)  ? pearson  : 0,
      pairs: pairs.length,
      interpretation: classifyCorrelation(headline, pairs.length),
    };
  }
}

export default MetricComparator;

// ---------- helpers ----------

function scoreReliability(a, b) {
  const minRatio = Math.min(coverageRatio(a), coverageRatio(b));
  if (minRatio >= 0.7) return 'high';
  if (minRatio >= 0.4) return 'medium';
  return 'low';
}

function coverageRatio(side) {
  if (!side || side.daysInPeriod <= 0) return 0;
  return side.daysCovered / side.daysInPeriod;
}

function computeVariance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
}

function classifyShape(values, totalVariance) {
  if (values.length < 2) return 'step';
  // Monotonic: every consecutive delta has the same sign (or is zero).
  let monotonicallyUp = true;
  let monotonicallyDown = true;
  let signFlips = 0;
  let prevSign = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) { monotonicallyDown = false; if (prevSign === -1) signFlips++; prevSign = 1; }
    else if (d < 0) { monotonicallyUp = false; if (prevSign === 1) signFlips++; prevSign = -1; }
  }
  if (monotonicallyUp || monotonicallyDown) return 'monotonic';
  if (signFlips >= 3) return 'volatile';
  // Coefficient of variation > 0.5 → volatile fallback
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean !== 0) {
    const stdev = Math.sqrt(totalVariance / 2);
    if (Math.abs(stdev / mean) > 0.5) return 'volatile';
  }
  // Has the trend reversed direction overall? sign of first-half slope vs second-half
  const mid = Math.floor(values.length / 2);
  const slopeA = (values[mid] - values[0]) / Math.max(1, mid);
  const slopeB = (values[values.length - 1] - values[mid]) / Math.max(1, values.length - 1 - mid);
  if (slopeA * slopeB < 0) return 'reversal';
  return 'step';
}

function findInflectionDate(buckets) {
  if (buckets.length < 2) return null;
  let maxAbs = 0;
  let maxIdx = -1;
  for (let i = 1; i < buckets.length; i++) {
    const a = buckets[i - 1].value;
    const b = buckets[i].value;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const d = Math.abs(b - a);
    if (d > maxAbs) { maxAbs = d; maxIdx = i; }
  }
  if (maxIdx < 0) return null;
  return buckets[maxIdx].period;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function buildDateMatcher(condition) {
  if ('weekday' in condition) {
    const idx = WEEKDAY_INDEX[condition.weekday];
    if (idx === undefined) throw new Error(`MetricComparator: unknown weekday "${condition.weekday}"`);
    return (date) => new Date(date + 'T00:00:00Z').getUTCDay() === idx;
  }
  if ('weekend' in condition) {
    const desired = condition.weekend === true;
    return (date) => {
      const d = new Date(date + 'T00:00:00Z').getUTCDay();
      return ((d === 0 || d === 6) === desired);
    };
  }
  if ('since' in condition) {
    return (date) => date >= condition.since;
  }
  if ('before' in condition) {
    return (date) => date < condition.before;
  }
  // For tracked/workout conditions, the presence matcher does the work; the
  // date matcher passes through.
  if ('tracked' in condition || 'workout' in condition) {
    return () => true;
  }
  throw new Error(`MetricComparator: unknown condition shape ${JSON.stringify(condition)}`);
}

function describeCondition(condition) {
  if ('tracked' in condition)  return condition.tracked  ? 'days with nutrition logged' : 'days without nutrition logged';
  if ('workout' in condition)  return condition.workout  ? 'days with at least one workout' : 'days with no workouts';
  if ('weekday' in condition)  return `${condition.weekday}s`;
  if ('weekend' in condition)  return condition.weekend  ? 'weekends' : 'weekdays';
  if ('since' in condition)    return `since ${condition.since}`;
  if ('before' in condition)   return `before ${condition.before}`;
  return 'unknown';
}

function aggregateBucket(values, statistic, kind) {
  if (kind === 'ratio') {
    const matched = values.filter(v => v === 1).length;
    return values.length > 0 ? matched / values.length : null;
  }
  if (statistic === 'count') return values.length;
  if (statistic === 'sum')   return values.reduce((s, v) => s + v, 0);
  if (statistic === 'min')   return Math.min(...values);
  if (statistic === 'max')   return Math.max(...values);
  // mean is default
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pearsonCorrelation(pairs) {
  const n = pairs.length;
  if (n < 2) return 0;
  const meanA = pairs.reduce((s, [a]) => s + a, 0) / n;
  const meanB = pairs.reduce((s, [, b]) => s + b, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (const [a, b] of pairs) {
    cov  += (a - meanA) * (b - meanB);
    varA += (a - meanA) * (a - meanA);
    varB += (b - meanB) * (b - meanB);
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

function spearmanCorrelation(pairs) {
  const n = pairs.length;
  if (n < 2) return 0;
  const ranksA = rankValues(pairs.map(([a]) => a));
  const ranksB = rankValues(pairs.map(([, b]) => b));
  const ranked = ranksA.map((ra, i) => [ra, ranksB[i]]);
  return pearsonCorrelation(ranked);
}

function rankValues(values) {
  // Standard fractional ranking (ties get the average of the positions).
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based avg
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function classifyCorrelation(r, pairs) {
  if (pairs < 2) return 'none';
  const a = Math.abs(r);
  if (a < 0.2) return 'none';
  if (a < 0.5) return r > 0 ? 'weak-positive' : 'weak-negative';
  return r > 0 ? 'strong-positive' : 'strong-negative';
}
