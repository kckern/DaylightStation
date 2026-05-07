// backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs

import { EventAdapter } from '../EventAdapter.mjs';
import {
  computeHrStats, pickPrimaryHrSeries, normalizeKind, resolvePeriod, toIso,
} from '../EventQueryService.mjs';

export class FitnessEventAdapter extends EventAdapter {
  #sessionService;
  #householdId;
  #now;

  constructor({ sessionService, householdId, now = () => new Date() }) {
    super();
    if (!sessionService) throw new Error('FitnessEventAdapter: sessionService required');
    this.#sessionService = sessionService;
    this.#householdId = householdId;
    this.#now = now;
  }

  async list({ period, filter, limit }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
    let events = sessions.map(s => this.#sessionToEvent(s));
    if (filter?.type) events = events.filter(e => e.domain_extras.type === filter.type);
    if (filter?.kind) events = events.filter(e => e.domain_extras.kind_canonical === filter.kind);
    if (limit) events = events.slice(0, limit);

    // Eager hydration for narrow questions: when result set is small, fold the
    // full Session detail (populated metadata + computed HR stats) into each row
    // so the agent can describe events in one response — no get_event_detail
    // follow-up needed. Wide queries skip hydration to avoid N×getSession.
    if (events.length > 0 && events.length <= 3) {
      events = await Promise.all(events.map(e => this.#hydrate(e)));
    }

    return { events, meta: { kind: 'workout', period, n: events.length } };
  }

  async detail(id) {
    if (!id) throw new Error('FitnessEventAdapter: id required');
    const idStr = String(id);
    let session = null;

    if (/^\d{14}$/.test(idStr) && typeof this.#sessionService.getSession === 'function') {
      session = await this.#sessionService.getSession(idStr, this.#householdId).catch(() => null);
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
    if (!session) return { error: `event not found for id=${id}` };

    const baseEvent = this.#sessionToEvent(session);
    const series = pickPrimaryHrSeries(session.timeline?.series);
    const hr_stats = computeHrStats(series);
    return {
      ...baseEvent,
      scalars: { ...baseEvent.scalars, hr_stats },
      session_full: typeof session.toJSON === 'function' ? session.toJSON() : session,
      timeline: session.timeline ?? null,
      strava: session.strava ?? null,
      strava_notes: session.strava_notes ?? null,
      treasureBox: session.treasureBox ?? null,
      snapshots: session.snapshots ?? null,
      entities: session.entities ?? null,
      summary_block: session.summary ?? null,
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
    const by_kind = {};
    let total_min = 0;
    for (const s of sessions) {
      const k = normalizeKind(s.strava?.type);
      by_kind[k] = (by_kind[k] || 0) + 1;
      if (s.durationMs) total_min += Math.round(s.durationMs / 60000);
    }
    return { n: sessions.length, by_kind, total_min };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #sessionToEvent(s) {
    const iso = toIso(s.startTime);
    const type = s.strava?.type ?? 'Workout';
    const dur = s.durationMs ? Math.round(s.durationMs / 60000) : null;
    return {
      kind: 'workout',
      id: s.sessionId?.toString?.() ?? String(s.sessionId),
      timestamp: iso,
      date: iso ? iso.slice(0, 10) : null,
      label: `${dur ?? '?'} min ${type}`,
      scalars: {
        duration_min: dur,
        kcal: s.metadata?.kcal ?? null,
        hr_avg: s.metadata?.hr_avg ?? null,
        hr_max: s.metadata?.hr_max ?? null,
        distance_mi: s.metadata?.distance_mi ?? null,
      },
      domain_extras: {
        strava_id: s.strava?.id ?? null,
        type: s.strava?.type ?? null,
        kind_canonical: normalizeKind(s.strava?.type),
        name: s.strava?.name ?? null,
        source: s.strava ? 'strava' : 'local',
      },
    };
  }

  async #hydrate(event) {
    if (typeof this.#sessionService.getSession !== 'function') return event;
    let full;
    try {
      full = await this.#sessionService.getSession(event.id, this.#householdId);
    } catch {
      return event;
    }
    if (!full) return event;
    const series = pickPrimaryHrSeries(full.timeline?.series);
    const hr_stats = computeHrStats(series);
    return {
      ...event,
      scalars: {
        ...event.scalars,
        kcal:        full.metadata?.kcal        ?? event.scalars.kcal,
        hr_avg:      full.metadata?.hr_avg      ?? hr_stats.mean ?? event.scalars.hr_avg,
        hr_max:      full.metadata?.hr_max      ?? hr_stats.max  ?? event.scalars.hr_max,
        distance_mi: full.metadata?.distance_mi ?? event.scalars.distance_mi,
        hr_stats,
      },
    };
  }
}

export default FitnessEventAdapter;
