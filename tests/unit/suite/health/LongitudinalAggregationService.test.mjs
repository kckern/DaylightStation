// tests/unit/suite/health/LongitudinalAggregationService.test.mjs
import { LongitudinalAggregationService } from '../../../../backend/src/3_applications/health/LongitudinalAggregationService.mjs';

function makeDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function makeStubStores({ sessions = {}, weight = {}, nutrition = {}, fitness = {}, reconciliation = {} } = {}) {
  return {
    sessionDatastore: {
      findInRange: async () => {
        const all = [];
        for (const [date, list] of Object.entries(sessions)) {
          for (const s of list) all.push({ date, ...s });
        }
        return all;
      },
    },
    healthStore: {
      loadWeightData: async () => weight,
      loadNutritionData: async () => nutrition,
      loadFitnessData: async () => fitness,
      loadReconciliationData: async () => reconciliation,
    },
  };
}

describe('LongitudinalAggregationService', () => {
  test('returns 30 daily entries sorted oldest to newest', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    expect(result.daily).toHaveLength(30);
    expect(result.daily[0].date < result.daily[29].date).toBe(true);
  });

  test('returns ~26 weekly entries sorted oldest to newest', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    expect(result.weekly.length).toBeGreaterThanOrEqual(25);
    expect(result.weekly.length).toBeLessThanOrEqual(27);
    expect(result.weekly[0].weekStart < result.weekly[result.weekly.length - 1].weekStart).toBe(true);
  });

  test('aggregates exercise minutes from sessions', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      sessions: {
        [today]: [
          { durationMs: 1800000, strava: { calories: 300, avgHeartrate: 140 } },
          { durationMs: 2700000, strava: { calories: 450, avgHeartrate: 150 } },
        ],
      },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.exerciseMinutes).toBe(75);
    expect(todayEntry.caloriesBurned).toBe(750);
  });

  test('includes nutrition protein', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      nutrition: { [today]: { protein: 145, calories: 2100 } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.protein).toBe(145);
  });

  test('includes steps from fitness data', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      fitness: { [today]: { steps: { steps_count: 9500 } } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.steps).toBe(9500);
  });

  test('includes calorie balance from reconciliation', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      reconciliation: { [today]: { calorie_adjustment: -410 } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.calorieBalance).toBe(-410);
  });

  test('weekly aggregates weight and calorie balance', async () => {
    // Put weight data 7 days ago (within first week from end)
    const day7 = makeDateStr(7);
    const day8 = makeDateStr(8);
    const stores = makeStubStores({
      weight: {
        [day7]: { lbs_adjusted_average: 185, calorie_balance: -300 },
        [day8]: { lbs_adjusted_average: 186, calorie_balance: -400 },
      },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    // Find the week containing day7
    const week = result.weekly.find(w => w.weekStart <= day7 && w.weekEnd >= day7);
    if (week) {
      expect(week.avgWeight).toBeGreaterThan(0);
      expect(week.weightCalorieBalance).toBeLessThan(0);
    }
  });

  test('null fields when data is missing for a day', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    // All days should have null for missing data
    expect(result.daily[0].protein).toBeNull();
    expect(result.daily[0].steps).toBeNull();
    expect(result.daily[0].calorieBalance).toBeNull();
    // Exercise defaults to 0 (no sessions = 0 minutes)
    expect(result.daily[0].exerciseMinutes).toBe(0);
  });
});
