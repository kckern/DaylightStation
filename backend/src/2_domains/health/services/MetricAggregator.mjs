// backend/src/2_domains/health/services/MetricAggregator.mjs

import { MetricRegistry } from './MetricRegistry.mjs';

const STATS = ['mean', 'median', 'min', 'max', 'count', 'sum', 'p25', 'p75', 'stdev'];

/**
 * Five operations for aggregating per-day metric data over a period:
 *   - aggregate({ userId, metric, period, statistic? }) → single value
 *   - aggregateSeries (Task 4)
 *   - distribution    (Task 5)
 *   - percentile      (Task 6)
 *   - snapshot        (Task 7)
 *
 * Pulls daily values via the existing IHealthDataDatastore (weight + nutrition)
 * and via healthService.getHealthForRange() (workouts). PeriodResolver turns
 * the polymorphic period input into [from, to].
 *
 * @typedef {object} MetricAggregatorDeps
 * @property {object} healthStore    - IHealthDataDatastore
 * @property {object} healthService  - exposes getHealthForRange(userId, from, to)
 * @property {object} periodResolver - PeriodResolver instance
 */
export class MetricAggregator {
  /** @param {MetricAggregatorDeps} deps */
  constructor(deps) {
    if (!deps?.healthStore) throw new Error('MetricAggregator requires healthStore');
    if (!deps?.healthService) throw new Error('MetricAggregator requires healthService');
    if (!deps?.periodResolver) throw new Error('MetricAggregator requires periodResolver');
    this.healthStore = deps.healthStore;
    this.healthService = deps.healthService;
    this.periodResolver = deps.periodResolver;
  }

  /**
   * Compute a single statistic for a metric over a period.
   *
   * @returns {Promise<{
   *   metric: string, period: object, statistic: string,
   *   value: number|null, unit: string,
   *   daysCovered: number, daysInPeriod: number
   * }>}
   */
  async aggregate({ userId, metric, period, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);  // throws on unknown
    if (!STATS.includes(statistic)) {
      throw new Error(`MetricAggregator: unknown statistic "${statistic}"`);
    }
    const resolved = this.periodResolver.resolve(period);
    const daysInPeriod = daysBetweenInclusive(resolved.from, resolved.to);

    const { values, daysCovered } = await this.#collectValues({ userId, reg, from: resolved.from, to: resolved.to });

    let value;
    if (reg.kind === 'ratio') {
      // For ratio metrics (e.g. tracking_density), `values` contains 0s and
      // 1s (read returns 1 for tracked days, 0 for untracked-but-present
      // entries). The headline value is matched / daysInPeriod, NOT
      // mean(values) — the latter would double-count by ignoring days with
      // no entry at all. `statistic` is ignored on ratio metrics.
      const matched = values.filter(v => v === 1).length;
      value = daysInPeriod > 0 ? matched / daysInPeriod : null;
    } else if (statistic === 'count') {
      value = daysCovered;
    } else if (values.length === 0) {
      value = null;
    } else {
      value = computeStatistic(values, statistic);
    }

    return {
      metric,
      period: resolved,
      statistic,
      value,
      unit: reg.unit,
      daysCovered,
      daysInPeriod,
    };
  }

  /**
   * Bucketed series — same metric/statistic semantics as `aggregate`, but
   * returns one row per bucket. Granularity: daily | weekly | monthly |
   * quarterly | yearly.
   */
  async aggregateSeries({ userId, metric, period, granularity, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);
    if (!STATS.includes(statistic)) throw new Error(`MetricAggregator: unknown statistic "${statistic}"`);
    if (!['daily','weekly','monthly','quarterly','yearly'].includes(granularity)) {
      throw new Error(`MetricAggregator: unknown granularity "${granularity}"`);
    }
    const resolved = this.periodResolver.resolve(period);
    const dailyRows = await this.#collectDailyRows({ userId, reg, from: resolved.from, to: resolved.to });

    // Group by bucket key.
    const bucketKey = bucketKeyFn(granularity);
    const buckets = new Map();
    for (const row of dailyRows) {
      const key = bucketKey(row.date);
      if (!buckets.has(key)) buckets.set(key, { period: key, values: [] });
      buckets.get(key).values.push(row.value);
    }

    const out = [...buckets.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(b => {
        let value;
        if (reg.kind === 'ratio') {
          const matched = b.values.filter(v => v === 1).length;
          value = matched / b.values.length;
        } else if (statistic === 'count') {
          value = b.values.length;
        } else {
          value = computeStatistic(b.values, statistic);
        }
        return { period: b.period, value, count: b.values.length };
      });

    return { metric, period: resolved, granularity, statistic, unit: reg.unit, buckets: out };
  }

  async distribution({ userId, metric, period, bins = null }) {
    const reg = MetricRegistry.get(metric);
    const resolved = this.periodResolver.resolve(period);
    const rows = await this.#collectDailyRows({ userId, reg, from: resolved.from, to: resolved.to });
    const values = rows.map(r => r.value);
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const out = {
      metric,
      period: resolved,
      unit: reg.unit,
      count: n,
      min: n ? sorted[0] : null,
      max: n ? sorted[n - 1] : null,
      mean: n ? sorted.reduce((s, v) => s + v, 0) / n : null,
      median: n ? percentileFromSorted(sorted, 0.5) : null,
      stdev: n ? computeStatistic(values, 'stdev') : null,
      quartiles: {
        p25: n ? percentileFromSorted(sorted, 0.25) : null,
        p50: n ? percentileFromSorted(sorted, 0.5)  : null,
        p75: n ? percentileFromSorted(sorted, 0.75) : null,
      },
    };

    if (typeof bins === 'number' && bins >= 1 && n > 0) {
      const lo = sorted[0];
      const hi = sorted[n - 1];
      const span = hi - lo || 1; // avoid divide-by-zero on degenerate distributions
      const histogram = [];
      for (let i = 0; i < bins; i++) {
        const binStart = lo + (span * i) / bins;
        const binEnd = lo + (span * (i + 1)) / bins;
        const isLast = i === bins - 1;
        const count = sorted.filter(v => v >= binStart && (isLast ? v <= binEnd : v < binEnd)).length;
        histogram.push({ binStart, binEnd, count });
      }
      out.histogram = histogram;
    }

    return out;
  }

  /**
   * Internal: like #collectValues, but returns per-row { date, value } so the
   * caller can group them by bucket key. Mirrors the same source dispatch.
   */
  async #collectDailyRows({ userId, reg, from, to }) {
    const rows = [];
    if (reg.source === 'weight') {
      const data = await this.healthStore.loadWeightData(userId);
      for (const [date, entry] of Object.entries(data || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(entry);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    } else if (reg.source === 'nutrition') {
      const data = await this.healthStore.loadNutritionData(userId);
      for (const [date, entry] of Object.entries(data || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(entry);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    } else if (reg.source === 'workouts') {
      const range = await this.healthService.getHealthForRange(userId, from, to);
      for (const [date, metricEntry] of Object.entries(range || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(metricEntry?.workouts);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    }
    return rows;
  }

  /**
   * Pull the raw per-day numeric values for a metric over [from, to].
   * Returns the values array (only the days that produced a numeric reading)
   * plus a daysCovered count.
   *
   * For ratio metrics, `values` will contain 0s and 1s, and `daysCovered`
   * counts the number of days that returned a finite value (i.e. days that
   * had a nutrition entry at all). The aggregator's ratio branch does the
   * matched/daysInPeriod math separately.
   *
   * @returns {Promise<{ values: number[], daysCovered: number }>}
   */
  async #collectValues({ userId, reg, from, to }) {
    if (reg.source === 'weight') {
      const data = await this.healthStore.loadWeightData(userId);
      return collectFromKeyedRows(data, from, to, reg.read);
    }
    if (reg.source === 'nutrition') {
      const data = await this.healthStore.loadNutritionData(userId);
      return collectFromKeyedRows(data, from, to, reg.read);
    }
    if (reg.source === 'workouts') {
      const range = await this.healthService.getHealthForRange(userId, from, to);
      const values = [];
      let daysCovered = 0;
      for (const [date, metricEntry] of Object.entries(range || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(metricEntry?.workouts);
        if (typeof v === 'number' && Number.isFinite(v)) {
          values.push(v);
          if (v > 0) daysCovered++;  // a "covered" workout day is one with at least one workout
        }
      }
      return { values, daysCovered };
    }
    throw new Error(`MetricAggregator: unknown metric source "${reg.source}"`);
  }
}

// ---------- helpers ----------

function collectFromKeyedRows(data, from, to, readFn) {
  const values = [];
  let daysCovered = 0;
  for (const [date, entry] of Object.entries(data || {})) {
    if (date < from || date > to) continue;
    const v = readFn(entry);
    if (typeof v === 'number' && Number.isFinite(v)) {
      values.push(v);
      daysCovered++;
    }
  }
  return { values, daysCovered };
}

function daysBetweenInclusive(from, to) {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to + 'T00:00:00Z');
  return Math.round((t - f) / 86400000) + 1;
}

function computeStatistic(values, stat) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (stat === 'mean') return sorted.reduce((s, v) => s + v, 0) / n;
  if (stat === 'sum')  return sorted.reduce((s, v) => s + v, 0);
  if (stat === 'min')  return sorted[0];
  if (stat === 'max')  return sorted[n - 1];
  if (stat === 'median') return percentileFromSorted(sorted, 0.5);
  if (stat === 'p25')    return percentileFromSorted(sorted, 0.25);
  if (stat === 'p75')    return percentileFromSorted(sorted, 0.75);
  if (stat === 'stdev') {
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    return Math.sqrt(variance);
  }
  throw new Error(`computeStatistic: unhandled statistic "${stat}"`);
}

function percentileFromSorted(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function bucketKeyFn(granularity) {
  if (granularity === 'daily')     return (d) => d;
  if (granularity === 'monthly')   return (d) => d.slice(0, 7);
  if (granularity === 'yearly')    return (d) => d.slice(0, 4);
  if (granularity === 'quarterly') return (d) => {
    const m = parseInt(d.slice(5, 7), 10);
    return `${d.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
  };
  // weekly: ISO week
  return (d) => {
    const [y, m, day] = d.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, day));
    const dow = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dow);
    const isoYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 4));
    const ysDow = yearStart.getUTCDay() || 7;
    yearStart.setUTCDate(yearStart.getUTCDate() + 4 - ysDow);
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
  };
}

// Exports for unit tests of helpers if they grow.
export { computeStatistic, percentileFromSorted };
