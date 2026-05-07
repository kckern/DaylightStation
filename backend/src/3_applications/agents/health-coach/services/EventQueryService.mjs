// backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs

const SUPPORTED_KINDS = new Set(['workout']);  // future: 'meal', 'weigh_in'

const ALLOWED_FILTER_KEYS = new Set(['type', 'kind']);

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

export class EventQueryService {
  #sessionService;
  #householdId;
  #now;

  constructor({ sessionService, householdId, now = () => new Date() }) {
    if (!sessionService) throw new Error('EventQueryService: sessionService required');
    this.#sessionService = sessionService;
    this.#householdId = householdId;
    this.#now = now;
  }

  async queryEvents({ kind, period, filter, limit }) {
    if (!SUPPORTED_KINDS.has(kind)) {
      throw new Error(`EventQueryService: unsupported kind "${kind}"`);
    }
    validateFilter(filter);
    const { from, to } = this.#resolvePeriod(period);

    if (kind === 'workout') {
      const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
      let events = sessions.map(s => this.#sessionToEvent(s));
      if (filter?.type) events = events.filter(e => e.type === filter.type);
      if (limit) events = events.slice(0, limit);

      // Eager hydration for narrow questions: when result set is small, fold the
      // full Session detail (populated metadata + computed HR stats) into each row
      // so the agent can describe events in one response — no get_event_detail
      // follow-up needed. Wide queries skip hydration to avoid N×getSession.
      if (events.length > 0 && events.length <= 3) {
        events = await Promise.all(events.map(e => this.#hydrate(e)));
      }

      return {
        events,
        meta: { kind, period, n: events.length, generated_at: this.#now().toISOString() },
      };
    }
    return { events: [], meta: { kind, n: 0, generated_at: this.#now().toISOString() } };
  }

  async getEventDetail({ id, kind = 'workout' }) {
    if (!id) throw new Error('EventQueryService: id required');
    if (kind !== 'workout') throw new Error(`EventQueryService: unsupported kind "${kind}"`);

    let session = null;
    const idStr = String(id);
    const looksLikeSessionId = /^\d{14}$/.test(idStr);

    if (looksLikeSessionId && typeof this.#sessionService.getSession === 'function') {
      session = await this.#sessionService.getSession(idStr, this.#householdId).catch(() => null);
    }
    if (!session && typeof this.#sessionService.getById === 'function') {
      session = await this.#sessionService.getById(idStr, this.#householdId).catch(() => null);
    }
    if (!session && typeof this.#sessionService.findByStravaId === 'function') {
      session = await this.#sessionService.findByStravaId(id, this.#householdId).catch(() => null);
    }
    if (!session && typeof this.#sessionService.listSessionsInRange === 'function') {
      const today = this.#now();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const fromDate = new Date(todayUtc);
      fromDate.setUTCDate(fromDate.getUTCDate() - 60);
      const all = await this.#sessionService.listSessionsInRange(
        fromDate.toISOString().slice(0, 10),
        todayUtc.toISOString().slice(0, 10),
        this.#householdId,
      ).catch(() => []);
      session = all.find(s =>
        String(s.sessionId) === idStr ||
        (s.strava && String(s.strava.id) === idStr)
      ) ?? null;
    }
    if (!session) {
      return { error: `event not found for id=${id}` };
    }
    return this.#sessionToDetail(session);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #resolvePeriod(period) {
    if (typeof period === 'string') return this.#resolvePeriod({ rolling: period });
    if (period?.rolling) {
      const m = /^last_(\d+)d$/.exec(period.rolling);
      if (m) {
        const days = parseInt(m[1], 10);
        const today = this.#now();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const fromDate = new Date(todayUtc);
        fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
        return { from: fromDate.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
      }
    }
    if (period?.from && period?.to) return { from: period.from, to: period.to };
    throw new Error(`EventQueryService: unsupported period ${JSON.stringify(period)}`);
  }

  async #hydrate(event) {
    if (typeof this.#sessionService.getSession !== 'function') return event;
    let full;
    try {
      full = await this.#sessionService.getSession(event.session_id, this.#householdId);
    } catch {
      return event;
    }
    if (!full) return event;
    const series = pickPrimaryHrSeries(full.timeline?.series);
    const hr_stats = computeHrStats(series);
    return {
      ...event,
      kcal:        full.metadata?.kcal        ?? event.kcal,
      hr_avg:      full.metadata?.hr_avg      ?? hr_stats.mean ?? event.hr_avg,
      hr_max:      full.metadata?.hr_max      ?? hr_stats.max  ?? event.hr_max,
      distance_mi: full.metadata?.distance_mi ?? event.distance_mi,
      hr_stats,
    };
  }

  #sessionToEvent(s) {
    const iso = this.#toIso(s.startTime);
    return {
      session_id: s.sessionId?.toString?.() ?? String(s.sessionId),
      strava_id: s.strava?.id ?? null,
      type: s.strava?.type ?? 'Workout',
      name: s.strava?.name ?? null,
      date: iso ? iso.slice(0, 10) : null,
      start_time: iso,
      duration_min: s.durationMs ? Math.round(s.durationMs / 60000) : null,
      kcal: s.metadata?.kcal ?? null,
      hr_avg: s.metadata?.hr_avg ?? null,
      hr_max: s.metadata?.hr_max ?? null,
      distance_mi: s.metadata?.distance_mi ?? null,
      source: s.strava ? 'strava' : 'local',
    };
  }

  #toIso(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    try { return new Date(v).toISOString(); } catch { return null; }
  }

  #sessionToDetail(s) {
    return {
      ...this.#sessionToEvent(s),
      timeline: {
        series: s.timeline?.series ?? {},
        events: s.timeline?.events ?? [],
      },
      metadata: s.metadata ?? {},
      strava: s.strava ?? null,
      strava_notes: s.strava_notes ?? null,
    };
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
