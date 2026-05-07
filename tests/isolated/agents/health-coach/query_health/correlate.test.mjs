import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  // calories and weight perfectly inversely correlated
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({
        '2026-05-08': { lbs: 171.0 },
        '2026-05-09': { lbs: 170.5 },
        '2026-05-10': { lbs: 170.0 },
      }),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 1300 },
        '2026-05-09': { calories: 1500 },
        '2026-05-10': { calories: 1700 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — correlate', () => {
  it('pearson correlation between calories and weight', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      correlate: { with: 'weight_lbs', method: 'pearson' },
      userId: 'kc',
    });
    expect(r.r).toBeCloseTo(-1, 1);
    expect(r.n).toBe(3);
  });

  it('spearman rank correlation', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      correlate: { with: 'weight_lbs', method: 'spearman' },
      userId: 'kc',
    });
    expect(r.r).toBeCloseTo(-1, 1);
  });
});
