import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeStore() {
  return {
    loadWeightData: async () => ({
      '2026-04-30': { lbs: 170.5, fat_pct: 22.1 },
      '2026-05-01': { lbs: 170.3, fat_pct: 22.0 },
      '2026-05-02': { lbs: 170.8, fat_pct: 22.2 },
    }),
    loadNutritionData: async () => ({
      '2026-04-30': { calories: 1500, protein: 95, carbs: 130, fat: 50, fiber: 30 },
      '2026-05-01': { calories: 1450, protein: 90, carbs: 125, fat: 48, fiber: 28 },
      '2026-05-02': { calories: 1480, protein: 92, carbs: 128, fat: 49, fiber: 29 },
    }),
  };
}
function makeHealthService() {
  return {
    getHealthForRange: async (userId, from, to) => ({
      '2026-04-30': { workouts: [{ type: 'run', duration: 30, kcal: 300, hr_avg: 145 }] },
      '2026-05-01': { workouts: [] },
      '2026-05-02': { workouts: [{ type: 'lift', duration: 45, kcal: 200, hr_avg: 110 }] },
    }),
  };
}

const today = () => new Date('2026-05-02T12:00:00Z');

describe('HealthQueryService.query — metric vocabulary', () => {
  it('returns weight_lbs daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'weight_lbs', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ date: '2026-04-30', value: 170.5 });
    expect(r.meta.metric).toBe('weight_lbs');
  });

  it('returns calories daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'calories', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([1500, 1450, 1480]);
  });

  it('returns protein_g daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'protein_g', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([95, 90, 92]);
  });

  it('returns workout_count daily series (counts workouts on each date)', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'workout_count', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([1, 0, 1]);
  });

  it('returns workout_kcal daily series (sums kcal across workouts on each date)', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'workout_kcal', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([300, 0, 200]);
  });

  it('returns fat_pct daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'fat_pct', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([22.1, 22.0, 22.2]);
  });

  it('throws on unknown metric', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    await expect(svc.query({ metric: 'unknown_metric', period: { rolling: 'last_3d' }, userId: 'kc' }))
      .rejects.toThrow(/unknown metric/i);
  });

  it('returns meta envelope with metric, period, granularity, n, generated_at', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'weight_lbs', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.meta).toMatchObject({ metric: 'weight_lbs', granularity: 'daily', n: 3 });
    expect(r.meta.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.meta.period).toEqual({ rolling: 'last_3d' });
  });
});

describe('HealthQueryService.query — period shorthand', () => {
  it('accepts bare-string rolling period', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'weight_lbs', period: 'last_3d', userId: 'kc' });
    expect(r.rows).toHaveLength(3);
  });
});
