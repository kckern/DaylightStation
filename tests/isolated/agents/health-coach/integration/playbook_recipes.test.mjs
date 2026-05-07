// tests/isolated/agents/health-coach/integration/playbook_recipes.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';
import { ComputeSandbox } from '../../../../../backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs';
import { PersonalConstantsService } from '../../../../../backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs';

function makeFixtureServices() {
  // 30 days of synthetic data with a known under-reporting pattern:
  // Logged: 1462 kcal/day (steady), workouts: 350 kcal/day
  // Weight: starts 170, slope -0.0014 lb/day → ~ -0.042 lb total over 30 days
  // → predicted Δw from logged deficit ≈ -5.05 lb (TDEE ~2051)
  // → actual Δw ≈ -0.042 lb → ~99% gap
  const startDate = new Date('2026-04-08T00:00:00Z');
  const weightData = {};
  const nutritionData = {};
  const workoutData = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(startDate);
    d.setUTCDate(startDate.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    weightData[date]    = { lbs: 170.0 - 0.0014 * i, fat_pct: 22.0 };
    nutritionData[date] = { calories: 1462, protein: 95, carbs: 130, fat: 50, fiber: 30, tracking_density: 0.92 };
    workoutData[date]   = { workouts: [{ type: 'mixed', duration: 45, kcal: 350, hr_avg: 130 }] };
  }
  return {
    healthStore: {
      loadWeightData:    async () => weightData,
      loadNutritionData: async () => nutritionData,
    },
    healthService: { getHealthForRange: async () => workoutData },
    dataService: {
      user: {
        read: async (userId, path) => path === 'profile/health.yml'
          ? { height_cm: 180, age: 40, sex: 'M', activity_pal: 1.55, scale_bias_lbs: 0 }
          : null,
      },
    },
    now: () => new Date('2026-05-07T12:00:00Z'),
  };
}

describe('integration: under-reporting-calories playbook recipe', () => {
  it('produces a ~99% gap as expected', async () => {
    const fix = makeFixtureServices();
    const queryService     = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const sandbox          = new ComputeSandbox();
    const constantsService = new PersonalConstantsService({ dataService: fix.dataService, healthStore: fix.healthStore });

    const slopeResult = await queryService.query({
      metric: 'weight_lbs', period: { rolling: 'last_30d' }, aggregate: 'regression', userId: 'kc',
    });
    const intakeResult = await queryService.query({
      metric: 'calories', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc',
    });
    const activityResult = await queryService.query({
      metric: 'workout_kcal', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc',
    });
    const constants = await constantsService.get('kc');

    const tdee = sandbox.evaluate(
      "10*kg + 6.25*cm - 5*age + 5 + activity",
      { kg: constants.weight_kg, cm: constants.height_cm, age: constants.age, activity: activityResult.value }
    );
    const predictedDw = sandbox.evaluate(
      "(intake - tdee) * 30 / 3500",
      { intake: intakeResult.value, tdee: tdee.value }
    );
    const actualDw = sandbox.evaluate(
      "slope * 30",
      { slope: slopeResult.slope }
    );
    const gap = sandbox.evaluate(
      "1 - actual_dw / predicted_dw",
      { actual_dw: actualDw.value, predicted_dw: predictedDw.value }
    );

    expect(intakeResult.value).toBeCloseTo(1462, 0);
    expect(activityResult.value).toBeCloseTo(350, 0);
    expect(tdee.value).toBeGreaterThan(1900);
    expect(tdee.value).toBeLessThan(2100);   // ~2051 with Mifflin+additive workout kcal
    expect(predictedDw.value).toBeLessThan(-3);    // strong predicted loss
    expect(actualDw.value).toBeCloseTo(-0.042, 2);  // tiny actual loss
    expect(gap.value).toBeGreaterThan(0.95);        // ~99% gap
  });
});

describe('integration: weight-trend-noise — rolling smoothing', () => {
  it('rolling-7-day mean produces a smoothed series', async () => {
    const fix = makeFixtureServices();
    const queryService = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const r = await queryService.query({
      metric: 'weight_lbs', period: { rolling: 'last_30d' },
      rolling: { fn: 'mean', window: 7 },
      userId: 'kc',
    });
    expect(r.rows).toHaveLength(30);
    // First 6 should be null due to insufficient window
    expect(r.rows[5].value).toBe(null);
    expect(r.rows[6].value).toBeCloseTo(170 - 0.0014 * 3, 2);
  });
});

describe('integration: weekend-vs-weekday-divergence', () => {
  it('groups calories by weekday/weekend correctly', async () => {
    const fix = makeFixtureServices();
    const queryService = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const r = await queryService.query({
      metric: 'calories', period: { rolling: 'last_30d' },
      group_by: 'weekday_vs_weekend', aggregate: 'mean',
      userId: 'kc',
    });
    // Synthetic data has identical kcal every day, so weekday and weekend means are equal
    expect(r.groups.weekday.value).toBeCloseTo(r.groups.weekend.value, 1);
    expect(r.groups.weekday.count + r.groups.weekend.count).toBe(30);
  });
});
