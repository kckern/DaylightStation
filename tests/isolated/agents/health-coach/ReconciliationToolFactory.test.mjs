import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReconciliationToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs';

describe('ReconciliationToolFactory', () => {
  const mockHealthStore = {
    loadReconciliationData: mock.fn(async () => ({
      '2026-03-23': {
        tracking_accuracy: 0.53,
        implied_intake: 2015,
        tracked_calories: 1063,
        derived_bmr: 1166,
        avg_tracking_accuracy: 0.53,
        exercise_calories: 400,
      },
      '2026-03-22': {
        tracking_accuracy: 0.38,
        implied_intake: 1527,
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
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    assert.ok(result.avgAccuracy !== undefined);
    assert.ok(result.days !== undefined);
    assert.ok(Array.isArray(result.days));
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
