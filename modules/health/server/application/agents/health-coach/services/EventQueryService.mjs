// backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs

const SUPPORTED_KINDS = new Set(['workout', 'meal', 'weigh_in']);

const ALLOWED_FILTER_KEYS = new Set(['type', 'kind']);

const KIND_MAP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'cycle', VirtualRide: 'cycle', EBikeRide: 'cycle', GravelRide: 'cycle', MountainBikeRide: 'cycle',
  WeightTraining: 'strength', Crossfit: 'strength', Workout: 'strength',
  Walk: 'walk', Hike: 'walk',
  Yoga: 'yoga',
  Swim: 'swim',
};

export function normalizeKind(stravaType) {
  if (!stravaType) return 'other';
  return KIND_MAP[stravaType] || 'other';
}

export function validateFilter(filter) {
  if (filter === null || filter === undefined) return;
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error(`filter must be an object like { type: 'Run' } or { kind: 'strength' } — got ${typeof filter}: ${JSON.stringify(filter)}`);
  }
  for (const k of Object.keys(filter)) {
    if (!ALLOWED_FILTER_KEYS.has(k)) {
      throw new Error(`unknown filter key "${k}" — allowed keys: ${[...ALLOWED_FILTER_KEYS].join(', ')}`);
    }
  }
}

export function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  try { return new Date(v).toISOString(); } catch { return null; }
}

export function resolvePeriod(period, now = () => new Date()) {
  if (typeof period === 'string') return resolvePeriod({ rolling: period }, now);
  if (period?.rolling) {
    const m = /^last_(\d+)d$/.exec(period.rolling);
    if (m) {
      const days = parseInt(m[1], 10);
      const today = now();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const fromDate = new Date(todayUtc);
      fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
      return { from: fromDate.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
    }
  }
  if (period?.from && period?.to) return { from: period.from, to: period.to };
  throw new Error(`unsupported period ${JSON.stringify(period)}`);
}

export class EventQueryService {
  #adapters;
  #baselineService;

  /**
   * Accepts the new { adapters } map shape, plus an optional baselineService.
   * Legacy { sessionService, householdId } construction is no longer supported;
   * callers must pass { adapters: { workout: new FitnessEventAdapter(...) } }.
   *
   * @param {{ adapters: object, baselineService?: object|null }} deps
   */
  constructor(deps) {
    if (deps?.adapters && typeof deps.adapters === 'object') {
      this.#adapters = deps.adapters;
      this.#baselineService = deps.baselineService ?? null;
    } else {
      throw new Error(
        'EventQueryService: { adapters } map required. ' +
        'Legacy { sessionService } construction has been replaced — ' +
        'use { adapters: { workout: new FitnessEventAdapter({ sessionService, householdId }) } }.'
      );
    }
  }

  async queryEvents({ kind, period, filter, limit, userId }) {
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    validateFilter(filter);
    const adapter = this.#adapters[kind];
    if (!adapter) return { events: [], meta: { kind, period, n: 0 } };

    // Fetch baselines and pick the relevant block for this kind.
    let baseline = null;
    if (this.#baselineService && userId) {
      const all = await this.#baselineService.getBaselines({ userId }).catch(() => null);
      if (all) {
        baseline = kind === 'workout'  ? (all.fitness   ?? null)
                 : kind === 'meal'     ? (all.nutrition ?? null)
                 : kind === 'weigh_in' ? (all.weight    ?? null)
                 : null;
      }
    }

    return adapter.list({ period, filter, limit }, { baseline });
  }

  async getEventDetail({ id, kind = 'workout' }) {
    if (!id) throw new Error('id required');
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    const adapter = this.#adapters[kind];
    if (!adapter) return { error: `no adapter for kind ${kind}` };
    return adapter.detail(id);
  }

  async getDomainSummary({ kind, period }) {
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    const adapter = this.#adapters[kind];
    if (!adapter) return { kind, n: 0 };
    return adapter.summary({ period });
  }
}

export function computeHrStats(series) {
  const empty = {
    n: 0, mean: null, max: null, min: null, p50: null, p90: null,
    drift_pct: null,
    bands: { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 },
  };
  if (!Array.isArray(series) || series.length === 0) return empty;

  const xs = series.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return empty;

  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / xs.length;

  const pct = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };

  const bands = { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 };
  for (const v of xs) {
    if (v < 120) bands.lt120++;
    else if (v < 140) bands.b120_139++;
    else if (v < 160) bands.b140_159++;
    else if (v < 180) bands.b160_179++;
    else bands.gte180++;
  }

  let drift_pct = null;
  if (xs.length >= 9) {
    const third = Math.floor(xs.length / 3);
    const firstMean = xs.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const lastMean  = xs.slice(-third).reduce((a, b) => a + b, 0) / third;
    if (firstMean > 0) drift_pct = (lastMean / firstMean - 1) * 100;
  }

  return {
    n: xs.length,
    mean: Math.round(mean * 10) / 10,
    max: Math.max(...xs),
    min: Math.min(...xs),
    p50: pct(50),
    p90: pct(90),
    drift_pct: drift_pct === null ? null : Math.round(drift_pct * 100) / 100,
    bands,
  };
}

export function pickPrimaryHrSeries(seriesMap) {
  if (!seriesMap || typeof seriesMap !== 'object' || Array.isArray(seriesMap)) return [];
  let best = [];
  for (const v of Object.values(seriesMap)) {
    if (Array.isArray(v) && v.length > best.length) best = v;
  }
  return best;
}

export default EventQueryService;
