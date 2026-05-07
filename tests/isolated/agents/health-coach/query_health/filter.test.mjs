import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 800 },
        '2026-05-09': { calories: 1500 },
        '2026-05-10': { calories: 950 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — filter', () => {
  it('keeps only rows where value < 1000', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [{ field: 'value', op: '<', value: 1000 }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-08', '2026-05-10']);
  });

  it('chains multiple filters (AND)', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [
        { field: 'value', op: '>=', value: 800 },
        { field: 'value', op: '<', value: 1000 },
      ],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-08', '2026-05-10']);
  });

  it('supports == and in', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [{ field: 'value', op: 'in', value: [950, 1500] }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.value).sort((a, b) => a - b)).toEqual([950, 1500]);
  });
});
