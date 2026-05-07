// tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { FitnessEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

describe('FitnessEventAdapter', () => {
  it('list returns event rows in the unified shape', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'TrailRun', name: 'Morning Run' },
      metadata: { hr_avg: 142, hr_max: 175, distance_mi: 4.2, kcal: 380 },
    };
    const fullSession = {
      ...session,
      timeline: { series: { kc: Array(60).fill(140) }, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => fullSession),
      },
      householdId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e.kind).toBe('workout');
    expect(e.id).toBe('20260507060000');
    expect(e.date).toBe('2026-05-07');
    expect(e.label).toMatch(/28.*TrailRun/);
    expect(e.scalars.duration_min).toBe(28);
    expect(e.scalars.hr_avg).toBe(142);
    expect(e.scalars.hr_max).toBe(175);
    expect(e.scalars.hr_stats).toBeDefined(); // hydrated, n ≤ 3
    expect(e.domain_extras.strava_id).toBe(12345);
    expect(e.domain_extras.type).toBe('TrailRun');
    expect(e.domain_extras.kind_canonical).toBe('run');
  });

  it('list filters by raw type', async () => {
    const sessions = [
      { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000, strava: { id: 1, type: 'TrailRun' }, metadata: {} },
      { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 60_000, strava: { id: 2, type: 'WeightTraining' }, metadata: {} },
      { sessionId: '3', startTime: '2026-05-05T06:00:00Z', durationMs: 60_000, strava: { id: 3, type: 'TrailRun' }, metadata: {} },
      { sessionId: '4', startTime: '2026-05-04T06:00:00Z', durationMs: 60_000, strava: { id: 4, type: 'TrailRun' }, metadata: {} },
    ];
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
      householdId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' }, filter: { type: 'TrailRun' } });
    expect(r.events).toHaveLength(3);
  });

  it('list filters by canonical kind', async () => {
    const sessions = [
      { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000, strava: { id: 1, type: 'TrailRun' }, metadata: {} },
      { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 60_000, strava: { id: 2, type: 'WeightTraining' }, metadata: {} },
      { sessionId: '3', startTime: '2026-05-05T06:00:00Z', durationMs: 60_000, strava: { id: 3, type: 'WeightTraining' }, metadata: {} },
      { sessionId: '4', startTime: '2026-05-04T06:00:00Z', durationMs: 60_000, strava: { id: 4, type: 'Crossfit' }, metadata: {} },
    ];
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
      householdId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' }, filter: { kind: 'strength' } });
    expect(r.events).toHaveLength(3);
    for (const e of r.events) expect(e.domain_extras.kind_canonical).toBe('strength');
  });

  it('detail returns full session JSON pass-through + hr_stats', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run' }, metadata: { hr_avg: 142 },
      timeline: { series: { kc: [120, 130, 140] }, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.detail('20260507060000');
    expect(r.id).toBe('20260507060000');
    expect(r.timeline.series.kc).toEqual([120, 130, 140]);
    expect(r.scalars.hr_stats).toBeDefined();
    expect(r.session_full).toBeDefined();
  });

  it('detail returns error envelope when not found', async () => {
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getSession: vi.fn(async () => null),
      },
      householdId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.detail('20260507060000');
    expect(r.error).toMatch(/not found/);
  });

  it('summary returns workouts/total + by_kind breakdown', async () => {
    const sessions = [
      { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000, strava: { type: 'Run' }, metadata: {} },
      { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 45 * 60_000, strava: { type: 'WeightTraining' }, metadata: {} },
      { sessionId: '3', startTime: '2026-05-05T06:00:00Z', durationMs: 30 * 60_000, strava: { type: 'Run' }, metadata: {} },
    ];
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
      householdId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_7d' } });
    expect(r.n).toBe(3);
    expect(r.by_kind.run).toBe(2);
    expect(r.by_kind.strength).toBe(1);
    expect(r.total_min).toBe(105);
  });
});
