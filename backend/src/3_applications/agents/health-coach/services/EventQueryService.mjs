// backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs

const SUPPORTED_KINDS = new Set(['workout']);  // future: 'meal', 'weigh_in'

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
    const { from, to } = this.#resolvePeriod(period);

    if (kind === 'workout') {
      const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
      let events = sessions.map(s => this.#sessionToEvent(s));
      if (filter?.type) events = events.filter(e => e.type === filter.type);
      if (limit) events = events.slice(0, limit);
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

export default EventQueryService;
