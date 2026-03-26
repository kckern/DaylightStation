import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReconciliationToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs';

// Helper: generate a date string N days ago from today
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

describe('ReconciliationToolFactory', () => {
  // Use dates relative to today: one mature (20 days ago) and one recent (3 days ago)
  const matureDate = daysAgo(20);
  const recentDate = daysAgo(3);

  const mockHealthStore = {
    loadReconciliationData: mock.fn(async () => ({
      [matureDate]: {
        tracking_accuracy: 0.53,
        implied_intake: 2015,
        tracked_calories: 1063,
        calorie_adjustment: 952,
        derived_bmr: 1166,
        avg_tracking_accuracy: 0.53,
        exercise_calories: 400,
      },
      [recentDate]: {
        tracking_accuracy: 0.38,
        implied_intake: 1527,
        calorie_adjustment: 947,
        tracked_calories: 580,
        avg_tracking_accuracy: 0.53,
        exercise_calories: 0,
      },
    })),
    loadAdjustedNutritionData: mock.fn(async () => ({
      '2026-03-23': {
        calories: 1850,
        protein: 160,
        portion_multiplier: 1.49,
        phantom_calories: 230,
      },
    })),
    loadCoachingData: mock.fn(async () => ({
      '2026-03-22': [{ message: 'old coaching', timestamp: '2026-03-22T10:00:00Z' }],
    })),
  };

  it('creates 3 tools', () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    assert.equal(tools.length, 3);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('get_reconciliation_summary'));
    assert.ok(names.includes('get_adjusted_nutrition'));
    assert.ok(names.includes('get_coaching_history'));
  });

  it('get_reconciliation_summary returns accuracy and days', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 30 });
    assert.ok(result.avgAccuracy !== undefined);
    assert.ok(result.days !== undefined);
    assert.ok(Array.isArray(result.days));
    assert.ok(result.maturity_note);
    assert.ok(result.matureDayCount !== undefined);
  });

  it('redacts implied_intake and tracking_accuracy for recent days (< 14 days old)', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 30 });

    const recent = result.days.find(d => d.date === recentDate);
    const mature = result.days.find(d => d.date === matureDate);

    // Recent day: should have tracked_calories and exercise_calories, but NOT implied_intake or tracking_accuracy
    assert.ok(recent, 'recent day should be present');
    assert.equal(recent.tracked_calories, 580);
    assert.equal(recent.exercise_calories, 0);
    assert.equal(recent.implied_intake, undefined, 'implied_intake must be redacted for recent days');
    assert.equal(recent.tracking_accuracy, undefined, 'tracking_accuracy must be redacted for recent days');
    assert.equal(recent.calorie_adjustment, undefined, 'calorie_adjustment must be redacted for recent days');

    // Mature day: should have all fields
    assert.ok(mature, 'mature day should be present');
    assert.equal(mature.tracked_calories, 1063);
    assert.equal(mature.implied_intake, 2015);
    assert.equal(mature.tracking_accuracy, 0.53);
    assert.equal(mature.calorie_adjustment, 952);
  });

  it('get_adjusted_nutrition returns adjusted data', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_adjusted_nutrition');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    assert.ok(result.days !== undefined);
  });

  it('get_coaching_history returns past coaching', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_coaching_history');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    assert.ok(result.entries !== undefined);
  });

  it('handles errors gracefully', async () => {
    const errorStore = {
      loadReconciliationData: mock.fn(async () => { throw new Error('read fail'); }),
      loadAdjustedNutritionData: mock.fn(async () => { throw new Error('read fail'); }),
      loadCoachingData: mock.fn(async () => { throw new Error('read fail'); }),
    };
    const factory = new ReconciliationToolFactory({ healthStore: errorStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    assert.ok(result.error);
  });
});
