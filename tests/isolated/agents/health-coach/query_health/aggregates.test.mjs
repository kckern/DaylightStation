import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc(weightSeries) {
  const data = Object.fromEntries(weightSeries.map(([d, v]) => [d, { lbs: v }]));
  return new HealthQueryService({
    healthStore: { loadWeightData: async () => data, loadNutritionData: async () => ({}) },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — aggregates', () => {
  const series = [
    ['2026-05-04', 170.0], ['2026-05-05', 170.5], ['2026-05-06', 171.0],
    ['2026-05-07', 170.7], ['2026-05-08', 171.2], ['2026-05-09', 170.9],
    ['2026-05-10', 171.3],
  ];

  it('mean', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'mean', userId: 'kc' });
    expect(r.value).toBeCloseTo(170.8, 1);
    expect(r.count).toBe(7);
  });

  it('sum', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'sum', userId: 'kc' });
    expect(r.value).toBeCloseTo(1195.6, 1);
  });

  it('min / max', async () => {
    const min = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'min', userId: 'kc' });
    const max = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'max', userId: 'kc' });
    expect(min.value).toBe(170.0);
    expect(max.value).toBe(171.3);
  });

  it('count', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'count', userId: 'kc' });
    expect(r.value).toBe(7);
  });

  it('p50 (median)', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'p50', userId: 'kc' });
    expect(r.value).toBeCloseTo(170.9, 1);
  });

  it('stdev', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'stdev', userId: 'kc' });
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(1);
    expect(r.mean).toBeCloseTo(170.8, 1);
  });

  it('regression', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'regression', userId: 'kc' });
    expect(r).toMatchObject({ slope: expect.any(Number), intercept: expect.any(Number), r_squared: expect.any(Number), n: 7 });
    expect(r.slope).toBeGreaterThan(0);  // slight uptrend
  });

  it('histogram', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: { op: 'histogram', bins: 3 }, userId: 'kc' });
    expect(r.bins).toHaveLength(3);
    expect(r.bins.reduce((s, b) => s + b.count, 0)).toBe(7);
    expect(r.bins[0]).toMatchObject({ lower: expect.any(Number), upper: expect.any(Number), count: expect.any(Number) });
  });

  it('aggregate=none (default) returns rows', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, userId: 'kc' });
    expect(r.rows).toHaveLength(7);
  });
});
