import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  // 2026-05-04 = Mon, 05 = Tue, 06 = Wed, 07 = Thu, 08 = Fri, 09 = Sat, 10 = Sun
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({
        '2026-05-04': { calories: 1500 },  // weekday
        '2026-05-05': { calories: 1400 },
        '2026-05-06': { calories: 1450 },
        '2026-05-07': { calories: 1500 },
        '2026-05-08': { calories: 1600 },  // weekday
        '2026-05-09': { calories: 1900 },  // weekend
        '2026-05-10': { calories: 1850 },  // weekend
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — group_by', () => {
  it('weekday_vs_weekend mean', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_7d' },
      group_by: 'weekday_vs_weekend', aggregate: 'mean', userId: 'kc',
    });
    expect(r.groups.weekday.value).toBeCloseTo(1490, 0);
    expect(r.groups.weekday.count).toBe(5);
    expect(r.groups.weekend.value).toBeCloseTo(1875, 0);
    expect(r.groups.weekend.count).toBe(2);
  });

  it('day_of_week mean', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_7d' },
      group_by: 'day_of_week', aggregate: 'mean', userId: 'kc',
    });
    expect(Object.keys(r.groups).sort()).toEqual(['Fri', 'Mon', 'Sat', 'Sun', 'Thu', 'Tue', 'Wed']);
    expect(r.groups.Sat.value).toBe(1900);
  });
});
