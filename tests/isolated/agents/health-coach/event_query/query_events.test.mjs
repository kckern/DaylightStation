import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

function makeSession({ sessionId, startTime, durationMs, type = 'Run', stravaId = null, hr_avg = 140, hr_max = 175, distance_mi = 4.2 }) {
  return {
    sessionId,
    startTime,
    durationMs,
    strava: stravaId ? { id: stravaId, type, name: `${type} on ${startTime.slice(0, 10)}` } : null,
    metadata: { hr_avg, hr_max, distance_mi, kcal: 380 },
  };
}

function makeSvc(sessions) {
  return new EventQueryService({
    sessionService: {
      listSessionsInRange: vi.fn(async () => sessions),
    },
    householdId: 'kckern',
  });
}

describe('EventQueryService.queryEvents — workouts', () => {
  it('returns one row per session with natural IDs', async () => {
    const sessions = [
      makeSession({ sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000, stravaId: 12345 }),
      makeSession({ sessionId: '20260506180000', startTime: '2026-05-06T18:00:00Z', durationMs: 45 * 60_000, type: 'WeightTraining', stravaId: 12340 }),
    ];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({
      session_id: '20260507060000',
      strava_id: 12345,
      type: 'Run',
      date: '2026-05-07',
      duration_min: 38,
      hr_avg: 140,
    });
    expect(r.events[1].type).toBe('WeightTraining');
  });

  it('handles sessions without Strava metadata', async () => {
    const sessions = [makeSession({ sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000 })];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events[0].strava_id).toBe(null);
    expect(r.events[0].session_id).toBe('20260507060000');
  });

  it('filters by type when type filter passed', async () => {
    const sessions = [
      makeSession({ sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 30_000, type: 'Run', stravaId: 1 }),
      makeSession({ sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 30_000, type: 'Ride', stravaId: 2 }),
    ];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' }, filter: { type: 'Run' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].type).toBe('Run');
  });

  it('returns meta envelope', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.meta).toMatchObject({ kind: 'workout', n: 0 });
  });

  it('throws on unsupported kind', async () => {
    const svc = makeSvc([]);
    await expect(svc.queryEvents({ kind: 'unsupported', period: { rolling: 'last_7d' } }))
      .rejects.toThrow(/kind/);
  });
});

describe('EventQueryService.queryEvents — eager hydration (n ≤ 3)', () => {
  it('hydrates rows with full metadata + computed HR stats when n=1', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run', name: 'Morning Run' },
      metadata: { kcal: null, hr_avg: null, hr_max: null, distance_mi: null },
    };
    const fullSession = {
      ...sparseSummary,
      metadata: { kcal: 380, hr_avg: 142, hr_max: 175, distance_mi: 4.2 },
      timeline: { series: { kc: [...Array(60).fill(130), ...Array(60).fill(150)] }, events: [] },
      strava_notes: null,
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async (id) => id === '20260507060000' ? fullSession : null),
      },
      householdId: 'kckern',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e.hr_avg).toBe(142);
    expect(e.hr_max).toBe(175);
    expect(e.kcal).toBe(380);
    expect(e.distance_mi).toBe(4.2);
    expect(e.hr_stats).toBeDefined();
    expect(e.hr_stats.n).toBe(120);
    expect(e.hr_stats.mean).toBe(140);
    expect(e.hr_stats.bands.b120_139).toBe(60);
    expect(e.hr_stats.bands.b140_159).toBe(60);
  });

  it('does NOT hydrate when n > 3 (avoid N×getSession on wide queries)', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `2026050${i + 1}060000`, startTime: `2026-05-0${i + 1}T06:00:00Z`,
      durationMs: 30 * 60_000, strava: null,
      metadata: { kcal: null, hr_avg: null, hr_max: null, distance_mi: null },
    }));
    const getSession = vi.fn();
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => five),
        getSession,
      },
      householdId: 'kckern',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(5);
    expect(getSession).not.toHaveBeenCalled();
    expect(r.events[0].hr_stats).toBeUndefined();
  });

  it('falls back to series-derived hr_avg when metadata.hr_avg is null but series exists', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: { id: 12345, type: 'Run', name: 'Morning Run' },
      metadata: { hr_avg: null, hr_max: null },
    };
    const fullSession = {
      ...sparseSummary,
      metadata: { hr_avg: null, hr_max: null },                       // detail metadata also missing
      timeline: { series: { kc: Array(120).fill(145) }, events: [] }, // but series has data
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async () => fullSession),
      },
      householdId: 'kckern',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events[0].hr_avg).toBe(145);  // derived from series
    expect(r.events[0].hr_max).toBe(145);
    expect(r.events[0].hr_stats.n).toBe(120);
  });

  it('survives getSession failure — returns sparse row, no throw', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: null, metadata: {},
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async () => { throw new Error('boom'); }),
      },
      householdId: 'kckern',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].hr_avg).toBe(null);  // unhydrated, but no crash
    expect(r.events[0].hr_stats).toBeUndefined();
  });

  it('skips hydration entirely when getSession is not on the service', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: null, metadata: {},
    };
    const svc = new EventQueryService({
      sessionService: { listSessionsInRange: vi.fn(async () => [sparseSummary]) },  // no getSession
      householdId: 'kckern',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].hr_stats).toBeUndefined();
  });
});
