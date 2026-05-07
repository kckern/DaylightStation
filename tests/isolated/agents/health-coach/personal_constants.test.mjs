import { describe, it, expect } from 'vitest';
import { PersonalConstantsService } from '../../../../backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs';

describe('PersonalConstantsService.get', () => {
  it('returns canonical shape from user profile', async () => {
    const svc = new PersonalConstantsService({
      dataService: {
        user: {
          read: async (path, userId) => {
            if (path === 'profile/health') {
              return { height_cm: 180, age: 40, sex: 'M', activity_pal: 1.55, scale_bias_lbs: 0 };
            }
            return null;
          },
        },
      },
      healthStore: {
        loadWeightData: async () => ({
          '2026-05-09': { lbs: 171.0 },
          '2026-05-10': { lbs: 170.8 },
        }),
      },
    });
    const c = await svc.get('kc');
    expect(c).toMatchObject({
      height_cm: 180,
      age: 40,
      sex: 'M',
      weight_lbs: 170.8,                                  // most recent weigh-in
      weight_kg: expect.closeTo(77.47, 1),
      activity_pal: 1.55,
      scale_bias_lbs: 0,
      bmr_formula: 'mifflin-st-jeor',
      calorie_per_lb_fat: 3500,
    });
  });

  it('throws when user profile missing', async () => {
    const svc = new PersonalConstantsService({
      dataService: { user: { read: async () => null } },
      healthStore: { loadWeightData: async () => ({}) },
    });
    await expect(svc.get('kc')).rejects.toThrow(/profile/);
  });

  it('returns null for weight_lbs when no weigh-ins exist', async () => {
    const svc = new PersonalConstantsService({
      dataService: {
        user: { read: async () => ({ height_cm: 180, age: 40, sex: 'M' }) },
      },
      healthStore: { loadWeightData: async () => ({}) },
    });
    const c = await svc.get('kc');
    expect(c.weight_lbs).toBe(null);
    expect(c.weight_kg).toBe(null);
  });

  it('defaults activity_pal to 1.55 if missing in profile', async () => {
    const svc = new PersonalConstantsService({
      dataService: {
        user: { read: async () => ({ height_cm: 180, age: 40, sex: 'F' }) },
      },
      healthStore: { loadWeightData: async () => ({ '2026-05-10': { lbs: 140.0 } }) },
    });
    const c = await svc.get('kc');
    expect(c.activity_pal).toBe(1.55);
    expect(c.scale_bias_lbs).toBe(0);
  });
});
