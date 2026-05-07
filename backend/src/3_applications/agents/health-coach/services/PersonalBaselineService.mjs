/**
 * PersonalBaselineService — T8 of the health-coach reflective architecture.
 *
 * Computes rolling baselines per domain (fitness / nutrition / weight) by
 * composing the domain adapters built in T4-T6.  Results are cached for 24h
 * at data/users/<userId>/profile/baselines.yml via dataService.user.
 */

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const median = (xs) => {
  const finite = xs.filter(Number.isFinite);
  if (!finite.length) return null;
  const s = [...finite].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------
// Pure baseline functions (exported for unit testing)
// ---------------------------------------------------------------------------

export function computeFitnessBaseline({ events, period_days }) {
  if (!events?.length) {
    return {
      n: 0, period_days,
      workouts_per_week_total: 0,
      workouts_per_week_by_kind: {},
      run: null, strength: null,
    };
  }

  const by_kind = {};
  for (const e of events) {
    const k = e.kind || 'other';
    by_kind[k] = (by_kind[k] || 0) + 1;
  }

  const weeks = period_days / 7;
  const workouts_per_week_by_kind = Object.fromEntries(
    Object.entries(by_kind).map(([k, n]) => [k, Math.round((n / weeks) * 100) / 100])
  );
  const workouts_per_week_total = Math.round((events.length / weeks) * 100) / 100;

  // Run block — only events with a finite duration_min count toward n
  const runs = events.filter(e => e.kind === 'run' && Number.isFinite(e.duration_min));
  const run = runs.length ? {
    n: runs.length,
    median_duration_min: median(runs.map(e => e.duration_min)),
    median_hr_avg:       median(runs.map(e => e.hr_avg)),
    median_hr_max:       median(runs.map(e => e.hr_max)),
    median_distance_mi:  median(runs.map(e => e.distance_mi)),
  } : null;

  // Strength block
  const strs = events.filter(e => e.kind === 'strength' && Number.isFinite(e.duration_min));
  const strength = strs.length ? {
    n: strs.length,
    median_duration_min: median(strs.map(e => e.duration_min)),
  } : null;

  return {
    n: events.length, period_days,
    workouts_per_week_total, workouts_per_week_by_kind,
    run, strength,
  };
}

export function computeNutritionBaseline({ logs, period_days }) {
  if (!logs?.length) {
    return { n: 0, period_days, days: 0, kcal_avg: null, protein_g_avg: null };
  }

  const dayKeys = new Set();
  let kcal_total = 0;
  let protein_total = 0;

  for (const l of logs) {
    const date = l.date || (l.timestamp || '').slice(0, 10);
    if (date) dayKeys.add(date);
    kcal_total    += l.totals?.calories  ?? 0;
    protein_total += l.totals?.protein_g ?? 0;
  }

  const days = dayKeys.size || 1;
  return {
    n: logs.length, period_days, days,
    kcal_avg:      Math.round(kcal_total    / days),
    protein_g_avg: Math.round(protein_total / days),
  };
}

export function computeWeightBaseline({ points, period_days }) {
  if (!points?.length) {
    return { n: 0, period_days, trim_mean: null, slope_lbs_per_30d: null };
  }

  const xs = points.map(p => p.weight_lbs).filter(Number.isFinite);
  if (xs.length === 0) {
    return { n: 0, period_days, trim_mean: null, slope_lbs_per_30d: null };
  }

  // 10% trimmed mean
  const sorted = [...xs].sort((a, b) => a - b);
  const trimN   = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trimN, sorted.length - trimN || sorted.length);
  const trim_mean = trimmed.reduce((a, b) => a + b, 0) / (trimmed.length || 1);

  // Slope via ordinary least squares (index as x, value as y)
  let slope = 0;
  if (xs.length >= 2) {
    const xMean = (xs.length - 1) / 2;
    const yMean = xs.reduce((a, b) => a + b, 0) / xs.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (i - xMean) * (xs[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }
    slope = den > 0 ? num / den : 0;
  }

  return {
    n: xs.length, period_days,
    trim_mean:          Math.round(trim_mean * 10) / 10,
    slope_lbs_per_30d:  Math.round(slope * 30 * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// PersonalBaselineService
// ---------------------------------------------------------------------------

export class PersonalBaselineService {
  #adapters;
  #dataService;
  #cacheTtlMs;
  #now;

  /**
   * @param {object} opts
   * @param {object} opts.adapters         - Map of adapter instances: { workout, meal, weigh_in }
   * @param {object} opts.dataService      - dataService with .user.read / .user.write
   * @param {number} [opts.cacheTtlMs]     - Cache TTL in ms (default 24h)
   * @param {function} [opts.now]          - () => Date (injectable for testing)
   */
  constructor({ adapters, dataService, cacheTtlMs = 24 * 60 * 60_000, now = () => new Date() }) {
    if (!adapters)     throw new Error('PersonalBaselineService: adapters map required');
    if (!dataService)  throw new Error('PersonalBaselineService: dataService required');
    this.#adapters    = adapters;
    this.#dataService = dataService;
    this.#cacheTtlMs  = cacheTtlMs;
    this.#now         = now;
  }

  /**
   * Returns baselines for a user, using cache when fresh.
   * @param {object} opts
   * @param {string} opts.userId
   * @returns {Promise<object>} baselines payload
   */
  async getBaselines({ userId }) {
    if (!userId) throw new Error('PersonalBaselineService: userId required');

    const cached = await this.#readCache(userId);
    if (cached && this.#isFresh(cached)) return cached;

    const fresh = await this.#computeAll(userId);
    await this.#writeCache(userId, fresh);
    return fresh;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  async #computeAll(_userId) {
    const [fit, nut, wt] = await Promise.all([
      this.#adapters.workout?.list({ period: { rolling: 'last_90d' }, limit: 10_000 })
        .catch(() => ({ events: [] })),
      this.#adapters.meal?.list({ period: { rolling: 'last_30d' }, limit: 10_000 })
        .catch(() => ({ events: [] })),
      this.#adapters.weigh_in?.list({ period: { rolling: 'last_30d' }, limit: 10_000 })
        .catch(() => ({ events: [] })),
    ]);

    const fitnessEvents = (fit?.events || []).map(e => ({
      kind:         e.domain_extras?.kind_canonical || 'other',
      duration_min: e.scalars?.duration_min  ?? null,
      hr_avg:       e.scalars?.hr_avg        ?? null,
      hr_max:       e.scalars?.hr_max        ?? null,
      distance_mi:  e.scalars?.distance_mi   ?? null,
    }));

    const nutritionLogs = (nut?.events || []).map(e => ({
      date:   e.date,
      totals: { calories: e.scalars?.kcal, protein_g: e.scalars?.protein_g },
    }));

    const weightPoints = (wt?.events || []).map(e => ({
      date:       e.date,
      weight_lbs: e.scalars?.weight_lbs,
    }));

    return {
      computed_at: this.#now().toISOString(),
      fitness:     computeFitnessBaseline({ events: fitnessEvents, period_days: 90 }),
      nutrition:   computeNutritionBaseline({ logs: nutritionLogs, period_days: 30 }),
      weight:      computeWeightBaseline({ points: weightPoints, period_days: 30 }),
    };
  }

  #isFresh(cached) {
    if (!cached?.computed_at) return false;
    const age = this.#now().getTime() - new Date(cached.computed_at).getTime();
    return age < this.#cacheTtlMs;
  }

  async #readCache(userId) {
    try { return await this.#dataService.user.read('profile/baselines', userId); }
    catch { return null; }
  }

  async #writeCache(userId, payload) {
    try { await this.#dataService.user.write('profile/baselines', payload, userId); }
    catch { /* non-fatal — cache miss on next call is acceptable */ }
  }
}

export default PersonalBaselineService;
