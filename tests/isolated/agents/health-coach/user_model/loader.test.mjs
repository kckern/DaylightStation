// tests/isolated/agents/health-coach/user_model/loader.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { UserModelService } from '../../../../../backend/src/3_applications/agents/health-coach/services/UserModelService.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

describe('UserModelService.composeContext', () => {
  it('composes a markdown block of profile + baselines', async () => {
    const profile = { weight_lbs: 175, height_cm: 180, age: 38, sex: 'M' };
    const baselines = {
      computed_at: '2026-05-07T08:00:00Z',
      fitness: {
        n: 20,
        workouts_per_week_total: 4.2,
        workouts_per_week_by_kind: { run: 2.5, strength: 1.5, walk: 0.2 },
        run: { median_duration_min: 35, median_hr_avg: 148, median_hr_max: 172, median_distance_mi: 4.5 },
        strength: { median_duration_min: 30 },
      },
      nutrition: { kcal_avg: 2200, protein_g_avg: 130 },
      weight: { trim_mean: 175.4, slope_lbs_per_30d: -0.5 },
    };
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => profile) },
      baselineService: { getBaselines: vi.fn(async () => baselines) },
      now: FROZEN_NOW,
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/Your model of this user/i);
    expect(ctx).toMatch(/175 lbs/);
    expect(ctx).toMatch(/Workouts: 4\.2\/wk/);
    expect(ctx).toMatch(/Typical run.*35.*148.*172/);
    expect(ctx).toMatch(/Calories: 2200\/d avg/);
    expect(ctx).toMatch(/Weight: 175\.4 lbs.*-0\.5 lbs\/30d/);
  });

  it('handles missing baselines gracefully', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({})) },
      baselineService: { getBaselines: vi.fn(async () => null) },
      now: FROZEN_NOW,
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/No baselines available yet/i);
  });

  it('handles partial baselines (no run, no nutrition data)', async () => {
    const baselines = {
      computed_at: '2026-05-07T08:00:00Z',
      fitness: { n: 5, workouts_per_week_total: 0.4, workouts_per_week_by_kind: { walk: 0.4 }, run: null, strength: null },
      nutrition: { n: 0, kcal_avg: null, protein_g_avg: null },
      weight: { n: 1, trim_mean: 175.0, slope_lbs_per_30d: 0 },
    };
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({ weight_lbs: 175 })) },
      baselineService: { getBaselines: vi.fn(async () => baselines) },
      now: FROZEN_NOW,
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/Workouts: 0\.4\/wk/);
    // No "Typical run" line when run is null
    expect(ctx).not.toMatch(/Typical run/);
    // No "Calories" line when kcal_avg null
    expect(ctx).not.toMatch(/Calories:/);
    expect(ctx).toMatch(/Weight: 175 lbs/);
  });

  it('survives baselineService throwing (returns minimal block)', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({ weight_lbs: 175 })) },
      baselineService: { getBaselines: vi.fn(async () => { throw new Error('boom'); }) },
      now: FROZEN_NOW,
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/175 lbs/);
    expect(ctx).toMatch(/No baselines available/i);
  });

  it('survives personalConstantsService throwing (omits Profile lines)', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => { throw new Error('boom'); }) },
      baselineService: { getBaselines: vi.fn(async () => null) },
      now: FROZEN_NOW,
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/Your model of this user/i);
  });

  it('includes Today section with date and weekday', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({})) },
      baselineService: { getBaselines: vi.fn(async () => null) },
      now: () => new Date('2026-05-07T12:00:00Z'),  // Thursday
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/### Today/);
    expect(ctx).toMatch(/Date: 2026-05-07 \(Thursday\)/);
    expect(ctx).toMatch(/ground truth.*relative days/i);
  });

  it('uses ISO date format consistently', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({})) },
      baselineService: { getBaselines: vi.fn(async () => null) },
      now: () => new Date('2026-01-01T00:00:00Z'),  // Thursday
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/Date: 2026-01-01 \(Thursday\)/);
  });
});
