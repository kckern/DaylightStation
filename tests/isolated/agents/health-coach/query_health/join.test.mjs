import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({
        '2026-05-08': { lbs: 170.0 },
        '2026-05-09': { lbs: 170.5 },
        '2026-05-10': { lbs: 170.3 },
      }),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 1500 },
        '2026-05-09': { calories: 1450 },
        '2026-05-10': { calories: 1480 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — join', () => {
  it('joins weight_lbs onto calories rows', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      join: ['weight_lbs'],
      userId: 'kc',
    });
    expect(r.rows[0]).toMatchObject({ date: '2026-05-08', value: 1500, weight_lbs: 170.0 });
  });

  it('filter can reference joined fields', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      join: ['weight_lbs'],
      filter: [{ field: 'weight_lbs', op: '>', value: 170.2 }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-09', '2026-05-10']);
  });
});
