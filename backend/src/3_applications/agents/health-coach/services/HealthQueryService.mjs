const KNOWN_METRICS = new Set([
  'weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs',
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density',
  'workout_count', 'workout_duration_min', 'workout_kcal',
  'hr_avg', 'hr_max', 'hr_minutes_zone2',
]);

export class HealthQueryService {
  #healthStore;
  #healthService;
  #now;

  constructor({ healthStore, healthService, now = () => new Date() }) {
    if (!healthStore) throw new Error('HealthQueryService: healthStore required');
    if (!healthService) throw new Error('HealthQueryService: healthService required');
    this.#healthStore = healthStore;
    this.#healthService = healthService;
    this.#now = now;
  }

  async query({ metric, period, granularity = 'daily', aggregate = 'none', group_by, filter, join, userId, ...rest }) {
    if (!KNOWN_METRICS.has(metric)) {
      throw new Error(`HealthQueryService: unknown metric "${metric}"`);
    }
    if (!userId) throw new Error('HealthQueryService: userId required');

    const { from, to } = this.#resolvePeriod(period);
    let series = await this.#fetchSeries(metric, userId, from, to);

    // Join: pull other metrics onto each row by date (applied first)
    if (join?.length) {
      const joined = {};
      for (const otherMetric of join) {
        const otherRows = await this.#fetchSeries(otherMetric, userId, from, to);
        joined[otherMetric] = Object.fromEntries(otherRows.map(r => [r.date, r.value]));
      }
      series = series.map(row => {
        const out = { ...row };
        for (const m of join) out[m] = joined[m]?.[row.date] ?? null;
        return out;
      });
    }

    // Filter: chainable AND constraints (applied after join)
    if (filter?.length) {
      const filters = Array.isArray(filter) ? filter : [filter];
      series = series.filter(row => filters.every(f => this.#matchesFilter(row, f)));
    }

    const meta = {
      metric,
      period,
      granularity,
      n: series.length,
      generated_at: this.#now().toISOString(),
    };

    // Group by: bucket rows before aggregating
    if (group_by) {
      const groups = this.#groupBy(series, group_by, aggregate === 'none' ? 'mean' : aggregate);
      return { groups, meta };
    }

    return this.#aggregate(series, aggregate, meta);
  }

  #matchesFilter(row, { field, op, value }) {
    const lhs = row[field];
    switch (op) {
      case '<':      return lhs < value;
      case '<=':     return lhs <= value;
      case '==':     return lhs === value;
      case '>':      return lhs > value;
      case '>=':     return lhs >= value;
      case 'in':     return Array.isArray(value) && value.includes(lhs);
      case 'not_in': return Array.isArray(value) && !value.includes(lhs);
      default: throw new Error(`HealthQueryService: unknown filter op "${op}"`);
    }
  }

  #groupBy(series, key, aggregate) {
    const buckets = new Map();
    for (const row of series) {
      const k = this.#bucketKey(row, key);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(row);
    }
    const out = {};
    for (const [k, rows] of buckets) {
      const r = this.#aggregate(rows, aggregate, { metric: '', period: {}, granularity: '', n: rows.length, generated_at: '' });
      out[k] = { value: r.value, count: r.count };
    }
    return out;
  }

  #bucketKey(row, key) {
    if (key === 'day_of_week') {
      const day = new Date(row.date + 'T00:00:00Z').getUTCDay();  // 0 = Sun
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
    }
    if (key === 'weekday_vs_weekend') {
      const day = new Date(row.date + 'T00:00:00Z').getUTCDay();
      return (day === 0 || day === 6) ? 'weekend' : 'weekday';
    }
    if (key === 'month') return row.date.slice(0, 7);
    if (key === 'year')  return row.date.slice(0, 4);
    throw new Error(`HealthQueryService: unsupported group_by "${key}"`);
  }

  #aggregate(series, aggregate, meta) {
    const op = typeof aggregate === 'string' ? aggregate : (aggregate?.op ?? 'none');
    const opts = typeof aggregate === 'object' ? aggregate : {};

    if (op === 'none' || op === undefined) {
      return { rows: series, meta };
    }

    const values = series.map(r => r.value).filter(v => v !== null && v !== undefined && Number.isFinite(v));

    switch (op) {
      case 'mean':  return { value: this.#mean(values), count: values.length, meta };
      case 'sum':   return { value: values.reduce((s, v) => s + v, 0), count: values.length, meta };
      case 'min':   return { value: Math.min(...values), count: values.length, meta };
      case 'max':   return { value: Math.max(...values), count: values.length, meta };
      case 'count': return { value: values.length, count: values.length, meta };
      case 'p10':   return { value: this.#percentile(values, 10), count: values.length, meta };
      case 'p50':   return { value: this.#percentile(values, 50), count: values.length, meta };
      case 'p90':   return { value: this.#percentile(values, 90), count: values.length, meta };
      case 'stdev': {
        const m = this.#mean(values);
        const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, values.length - 1);
        return { value: Math.sqrt(v), mean: m, count: values.length, meta };
      }
      case 'regression': return { ...this.#regress(series), meta };
      case 'histogram':  return { bins: this.#histogram(values, opts.bins ?? 10), meta };
      default: throw new Error(`HealthQueryService: unknown aggregate "${op}"`);
    }
  }

  #mean(vs) { return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; }

  #percentile(vs, p) {
    if (!vs.length) return null;
    const sorted = [...vs].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  #regress(series) {
    const points = series.filter(r => Number.isFinite(r.value)).map((r, i) => ({ x: i, y: r.value }));
    const n = points.length;
    if (n < 2) return { slope: null, intercept: null, r_squared: null, n };
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const slope = den === 0 ? 0 : num / den;
    const intercept = my - slope * mx;
    const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const ssTot = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
    const r_squared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    return { slope, intercept, r_squared, n };
  }

  #histogram(vs, bins) {
    if (!vs.length) return [];
    const min = Math.min(...vs), max = Math.max(...vs);
    const width = (max - min) / bins || 1;
    const result = Array.from({ length: bins }, (_, i) => ({
      lower: min + i * width, upper: min + (i + 1) * width, count: 0,
    }));
    for (const v of vs) {
      const idx = Math.min(bins - 1, Math.floor((v - min) / width));
      result[idx].count += 1;
    }
    return result;
  }

  #resolvePeriod(period) {
    if (period?.rolling) {
      const m = /^last_(\d+)d$/.exec(period.rolling);
      if (m) {
        const days = parseInt(m[1], 10);
        const today = this.#now();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const from = new Date(todayUtc);
        from.setUTCDate(from.getUTCDate() - (days - 1));
        return { from: from.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
      }
    }
    if (period?.from && period?.to) return { from: period.from, to: period.to };
    throw new Error(`HealthQueryService: unsupported period ${JSON.stringify(period)}`);
  }

  async #fetchSeries(metric, userId, from, to) {
    if (['weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs'].includes(metric)) {
      const data = (await this.#healthStore.loadWeightData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, body]) => ({ date, value: this.#bodyMetric(body, metric) }));
    }
    if (['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density'].includes(metric)) {
      const data = (await this.#healthStore.loadNutritionData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, n]) => ({ date, value: this.#nutritionMetric(n, metric) }));
    }
    if (['workout_count', 'workout_duration_min', 'workout_kcal', 'hr_avg', 'hr_max', 'hr_minutes_zone2'].includes(metric)) {
      const range = (await this.#healthService.getHealthForRange(userId, from, to)) ?? {};
      return Object.entries(range)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({ date, value: this.#workoutMetric(day?.workouts ?? [], metric) }));
    }
    return [];
  }

  #bodyMetric(body, metric) {
    switch (metric) {
      case 'weight_lbs': return body.lbs ?? null;
      case 'weight_kg':  return body.lbs ? body.lbs * 0.453592 : (body.kg ?? null);
      case 'fat_pct':    return body.fat_pct ?? null;
      case 'lean_mass_lbs': return body.lbs && body.fat_pct ? body.lbs * (1 - body.fat_pct / 100) : null;
      default: return null;
    }
  }

  #nutritionMetric(n, metric) {
    switch (metric) {
      case 'calories':         return n.calories ?? 0;
      case 'protein_g':        return n.protein ?? 0;
      case 'carbs_g':          return n.carbs ?? 0;
      case 'fat_g':            return n.fat ?? 0;
      case 'fiber_g':          return n.fiber ?? 0;
      case 'tracking_density': return n.tracking_density ?? null;
      default: return null;
    }
  }

  #workoutMetric(workouts, metric) {
    switch (metric) {
      case 'workout_count':        return workouts.length;
      case 'workout_duration_min': return workouts.reduce((s, w) => s + (w.duration ?? 0), 0);
      case 'workout_kcal':         return workouts.reduce((s, w) => s + (w.kcal ?? 0), 0);
      case 'hr_avg':               return workouts.length ? workouts.reduce((s, w) => s + (w.hr_avg ?? 0), 0) / workouts.length : null;
      case 'hr_max':               return workouts.reduce((m, w) => Math.max(m, w.hr_max ?? 0), 0);
      case 'hr_minutes_zone2':     return workouts.reduce((s, w) => s + (w.zone2_min ?? 0), 0);
      default: return null;
    }
  }
}

export default HealthQueryService;
