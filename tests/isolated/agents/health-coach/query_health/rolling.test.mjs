import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  const data = {};
  for (let i = 1; i <= 14; i++) {
    const d = `2026-05-${String(i).padStart(2, '0')}`;
    data[d] = { lbs: 170 + i * 0.1 };
  }
  return new HealthQueryService({
    healthStore: { loadWeightData: async () => data, loadNutritionData: async () => ({}) },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-14T12:00:00Z'),
  });
}

describe('HealthQueryService.query — rolling', () => {
  it('rolling 7-day mean smooths the series', async () => {
    const r = await makeSvc().query({
      metric: 'weight_lbs', period: { rolling: 'last_14d' },
      rolling: { fn: 'mean', window: 7 },
      userId: 'kc',
    });
    expect(r.rows).toHaveLength(14);
    // First 6 entries have insufficient window — value should be null
    expect(r.rows[5].value).toBe(null);
    // 7th entry onward has values
    expect(r.rows[6].value).toBeCloseTo(170.4, 1);
    expect(r.rows[13].value).toBeCloseTo(171.1, 1);
  });
});
