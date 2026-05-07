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
