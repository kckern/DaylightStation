// backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs

/**
 * Trend and detection primitives. Builds on MetricAggregator —
 * trajectory uses ordinary-least-squares linear regression over a daily
 * series to produce slope/direction/r². Detection methods (regime change,
 * anomalies, sustained runs) operate on the same daily series.
 *
 * @typedef {object} MetricTrendAnalyzerDeps
 * @property {object} aggregator     - MetricAggregator instance
 * @property {object} periodResolver - PeriodResolver instance
 */
export class MetricTrendAnalyzer {
  constructor(deps) {
    if (!deps?.aggregator)     throw new Error('MetricTrendAnalyzer requires aggregator');
    if (!deps?.periodResolver) throw new Error('MetricTrendAnalyzer requires periodResolver');
    this.aggregator = deps.aggregator;
    this.periodResolver = deps.periodResolver;
  }

  /**
   * Slope, direction, fit quality over a period. Optionally returns the
   * bucketed series at the requested granularity.
   */
  async trajectory({ userId, metric, period, granularity = null, statistic = 'mean' }) {
    const resolved = this.periodResolver.resolve(period);
    const dailySeries = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily', statistic,
    });

    const points = dailySeries.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    if (points.length < 2) {
      return {
        metric, period: resolved,
        slope: null, slopePerWeek: null,
        direction: 'flat', rSquared: null,
        start: points[0] ?? null, end: points[points.length - 1] ?? null,
      };
    }

    const x = points.map((_, i) => i);  // day index 0..n-1
    const y = points.map(p => p.value);
    const reg = linearRegression(x, y);

    const slopePerWeek = reg.slope * 7;
    let direction;
    if (Math.abs(reg.slope) < 1e-9) direction = 'flat';
    else direction = reg.slope > 0 ? 'up' : 'down';

    const result = {
      metric, period: resolved,
      slope: reg.slope,
      slopePerWeek,
      direction,
      rSquared: reg.rSquared,
      start: { date: points[0].date, value: points[0].value },
      end:   { date: points[points.length - 1].date, value: points[points.length - 1].value },
    };

    if (granularity && granularity !== 'daily') {
      const bucketed = await this.aggregator.aggregateSeries({
        userId, metric, period, granularity, statistic,
      });
      result.bucketed = bucketed.buckets;
    }

    return result;
  }

  /**
   * Find inflection points where the metric's mean shifted significantly.
   * Returns up to `max_results` candidates ranked by magnitude.
   *
   * Algorithm: for each candidate split point i in [4, n-4], compute the
   * standardized difference between mean(values[0..i)) and mean(values[i..n)).
   * Threshold: |z| > 2 → candidate. Sort by magnitude descending.
   */
  async detectRegimeChange({ userId, metric, period, max_results = 3 }) {
    const resolved = this.periodResolver.resolve(period);
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    if (points.length < 8) {
      return { metric, period: resolved, changes: [] };
    }

    const candidates = [];
    const minWindow = 4;
    for (let i = minWindow; i < points.length - minWindow; i++) {
      const before = points.slice(0, i).map(p => p.value);
      const after  = points.slice(i).map(p => p.value);
      const meanB = before.reduce((s, v) => s + v, 0) / before.length;
      const meanA = after.reduce((s, v) => s + v, 0) / after.length;
      const stdB = Math.sqrt(before.reduce((s, v) => s + (v - meanB) ** 2, 0) / before.length);
      const stdA = Math.sqrt(after.reduce((s, v) => s + (v - meanA) ** 2, 0) / after.length);
      const pooledStd = Math.sqrt((stdB ** 2 + stdA ** 2) / 2);
      const magnitude = pooledStd > 0 ? Math.abs(meanA - meanB) / pooledStd : Math.abs(meanA - meanB);
      if (magnitude < 2) continue;
      // Slope on each side
      const slopeB = before.length > 1 ? (before[before.length - 1] - before[0]) / (before.length - 1) : 0;
      const slopeA = after.length > 1 ? (after[after.length - 1] - after[0]) / (after.length - 1) : 0;
      candidates.push({
        date: points[i].date,
        confidence: Math.min(1, magnitude / 4),  // saturating confidence
        before: { mean: meanB, slope: slopeB, daysCovered: before.length },
        after:  { mean: meanA, slope: slopeA, daysCovered: after.length },
        magnitude,
        description: `mean shifted from ${meanB.toFixed(2)} to ${meanA.toFixed(2)} (z=${magnitude.toFixed(2)})`,
      });
    }

    candidates.sort((a, b) => b.magnitude - a.magnitude);
    return { metric, period: resolved, changes: candidates.slice(0, max_results) };
  }

  /**
   * Days where the metric deviates from its rolling baseline by more than
   * `zScore_threshold` standard deviations.
   *
   * Baseline: previous `baseline_window_days` days (default 30) prior to each
   * day. Days early in the period that don't have a full baseline use what's
   * available, with a minimum of 5 baseline points required.
   */
  async detectAnomalies({
    userId, metric, period,
    zScore_threshold = 2,
    baseline_window_days = 30,
  }) {
    const resolved = this.periodResolver.resolve(period);
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    const anomalies = [];
    for (let i = 5; i < points.length; i++) {
      const baseStart = Math.max(0, i - baseline_window_days);
      const baseline = points.slice(baseStart, i).map(p => p.value);
      if (baseline.length < 5) continue;
      const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
      const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length;
      const stdev = Math.sqrt(variance);
      if (stdev === 0) continue;  // flat baseline → no anomaly possible
      const value = points[i].value;
      const zScore = (value - mean) / stdev;
      if (Math.abs(zScore) >= zScore_threshold) {
        anomalies.push({
          date: points[i].date,
          value,
          baselineMean: mean,
          baselineStdev: stdev,
          zScore,
          direction: zScore > 0 ? 'high' : 'low',
        });
      }
    }

    return {
      metric,
      period: resolved,
      baseline_period: { rolling_window_days: baseline_window_days },
      anomalies,
      count: anomalies.length,
    };
  }

  /**
   * Find consecutive-day runs where the metric satisfies a condition,
   * lasting at least `min_duration_days`.
   *
   * Conditions:
   *   { value_range: [min, max] }  — value within inclusive range
   *   { field_above: value }       — value > threshold
   *   { field_below: value }       — value < threshold
   */
  async detectSustained({ userId, metric, period, condition, min_duration_days }) {
    const resolved = this.periodResolver.resolve(period);
    const matcher = buildSustainedMatcher(condition);

    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    const runs = [];
    let runStart = -1;
    let runValues = [];

    for (let i = 0; i < points.length; i++) {
      const matches = matcher(points[i].value);
      if (matches) {
        if (runStart < 0) {
          runStart = i;
          runValues = [];
        }
        runValues.push(points[i].value);
      } else if (runStart >= 0) {
        // close current run
        const run = makeRun(points, runStart, i - 1, runValues);
        if (run.durationDays >= min_duration_days) runs.push(run);
        runStart = -1;
        runValues = [];
      }
    }
    if (runStart >= 0) {
      const run = makeRun(points, runStart, points.length - 1, runValues);
      if (run.durationDays >= min_duration_days) runs.push(run);
    }

    return {
      metric,
      period: resolved,
      condition,
      min_duration_days,
      runs,
    };
  }
}

export default MetricTrendAnalyzer;

// ---------- helpers ----------

function linearRegression(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    cov  += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) * (xs[i] - meanX);
    varY += (ys[i] - meanY) * (ys[i] - meanY);
  }

  if (varX === 0) {
    return { slope: 0, intercept: meanY, rSquared: 1 };
  }
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  // rSquared = 1 - SSres/SStot. For OLS, this equals correlation².
  const rSquared = varY === 0 ? 1 : (cov * cov) / (varX * varY);
  return { slope, intercept, rSquared };
}

export { linearRegression };

function buildSustainedMatcher(condition) {
  if (Array.isArray(condition?.value_range) && condition.value_range.length === 2) {
    const [lo, hi] = condition.value_range;
    return (v) => v >= lo && v <= hi;
  }
  if (typeof condition?.field_above === 'number') {
    const t = condition.field_above;
    return (v) => v > t;
  }
  if (typeof condition?.field_below === 'number') {
    const t = condition.field_below;
    return (v) => v < t;
  }
  throw new Error(`MetricTrendAnalyzer: unknown condition shape ${JSON.stringify(condition)}`);
}

function makeRun(points, fromIdx, toIdx, values) {
  const fromDate = points[fromIdx].date;
  const toDate = points[toIdx].date;
  // Days inclusive
  const f = new Date(fromDate + 'T00:00:00Z');
  const t = new Date(toDate + 'T00:00:00Z');
  const durationDays = Math.round((t - f) / 86400000) + 1;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    from: fromDate, to: toDate, durationDays,
    summary: { mean, min, max },
  };
}
