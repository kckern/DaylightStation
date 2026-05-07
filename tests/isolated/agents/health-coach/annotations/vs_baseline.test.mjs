// tests/isolated/agents/health-coach/annotations/vs_baseline.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { FitnessEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';
import { WeightEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs';
import { EventQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('FitnessEventAdapter — vs_baseline annotations', () => {
  it('attaches vs_baseline to run rows when run baseline supplied', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { activityId: 12345, type: 'Run' },
      metadata: { hr_avg: 136, hr_max: 158, distance_mi: 4.2 },
      timeline: { series: { kc: Array(60).fill(135) }, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const baseline = {
      run: { median_duration_min: 35, median_hr_avg: 148, median_hr_max: 172, median_distance_mi: 4.5 },
    };
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline });
    const vs = r.events[0].vs_baseline;
    expect(vs).toBeDefined();
    expect(vs.duration_min).toEqual({ typical: 35,  delta: -7,  delta_pct: -20 });
    expect(vs.hr_avg).toEqual(      { typical: 148, delta: -12, delta_pct: -8.1 });
    expect(vs.hr_max).toEqual(      { typical: 172, delta: -14, delta_pct: -8.1 });
    expect(vs.distance_mi).toEqual( { typical: 4.5, delta: -0.3, delta_pct: -6.7 });
  });

  it('attaches vs_baseline to strength rows when strength baseline supplied', async () => {
    const session = {
      sessionId: '20260506060000', startTime: '2026-05-06T06:00:00Z', durationMs: 25 * 60_000,
      strava: { activityId: 222, type: 'WeightTraining' },
      metadata: {},
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const baseline = { strength: { median_duration_min: 30 } };
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline });
    const vs = r.events[0].vs_baseline;
    expect(vs.duration_min).toEqual({ typical: 30, delta: -5, delta_pct: -16.7 });
  });

  it('skips vs_baseline when no matching kind block present', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { activityId: 12345, type: 'Run' }, metadata: { hr_avg: 136 },
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline: { run: null } });
    expect(r.events[0].vs_baseline).toBeUndefined();
  });

  it('skips vs_baseline entirely when baseline arg is omitted', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { activityId: 12345, type: 'Run' }, metadata: { hr_avg: 136 },
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } });
    expect(r.events[0].vs_baseline).toBeUndefined();
  });

  it('skips vs_baseline for unsupported kinds (cycle/walk/yoga/swim)', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 60 * 60_000,
      strava: { activityId: 12345, type: 'Ride' }, metadata: {},
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [session]),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } }, {
      baseline: { run: { median_duration_min: 35 }, strength: { median_duration_min: 30 } },
    });
    expect(r.events[0].vs_baseline).toBeUndefined();
  });
});

describe('WeightEventAdapter — vs_baseline annotations', () => {
  it('attaches vs_baseline to weight rows when baseline supplied', async () => {
    const range = {
      '2026-05-07': { date: '2026-05-07', weight: { lbs: 173.5 }, hasWeight: () => true },
      '2026-05-06': { date: '2026-05-06', weight: { lbs: 173.8 }, hasWeight: () => true },
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_7d' } }, { baseline: { trim_mean: 175.0 } });
    const vs = r.events[0].vs_baseline;
    expect(vs.weight_lbs).toEqual({ typical: 175.0, delta: -1.5, delta_pct: -0.9 });
  });

  it('skips vs_baseline when baseline.trim_mean is null', async () => {
    const range = {
      '2026-05-07': { date: '2026-05-07', weight: { lbs: 173.5 }, hasWeight: () => true },
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline: { trim_mean: null } });
    expect(r.events[0].vs_baseline).toBeUndefined();
  });
});

describe('EventQueryService — baseline pass-through', () => {
  it('queryEvents fetches baseline and forwards relevant block to adapter', async () => {
    const fakeAdapter = {
      list: vi.fn(async () => ({ events: [], meta: { kind: 'workout', n: 0 } })),
    };
    const baselineService = {
      getBaselines: vi.fn(async () => ({
        fitness: { run: { median_duration_min: 35 } },
        nutrition: { kcal_avg: 2200 },
        weight: { trim_mean: 175.0 },
      })),
    };
    const svc = new EventQueryService({ adapters: { workout: fakeAdapter }, baselineService });
    await svc.queryEvents({ kind: 'workout', period: 'last_7d', userId: 'kckern' });
    expect(baselineService.getBaselines).toHaveBeenCalledWith({ userId: 'kckern' });
    expect(fakeAdapter.list).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'last_7d' }),
      expect.objectContaining({ baseline: { run: { median_duration_min: 35 } } }),
    );
  });

  it('queryEvents survives baselineService failure (passes baseline=null)', async () => {
    const fakeAdapter = {
      list: vi.fn(async () => ({ events: [], meta: { kind: 'workout', n: 0 } })),
    };
    const baselineService = { getBaselines: vi.fn(async () => { throw new Error('boom'); }) };
    const svc = new EventQueryService({ adapters: { workout: fakeAdapter }, baselineService });
    const r = await svc.queryEvents({ kind: 'workout', period: 'last_7d', userId: 'kckern' });
    expect(r.meta.n).toBe(0);
    expect(fakeAdapter.list).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ baseline: null }),
    );
  });

  it('queryEvents works without baselineService (back-compat)', async () => {
    const fakeAdapter = {
      list: vi.fn(async () => ({ events: [], meta: { kind: 'workout', n: 0 } })),
    };
    const svc = new EventQueryService({ adapters: { workout: fakeAdapter } });
    await svc.queryEvents({ kind: 'workout', period: 'last_7d', userId: 'kckern' });
    expect(fakeAdapter.list).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ baseline: null }),
    );
  });
});
