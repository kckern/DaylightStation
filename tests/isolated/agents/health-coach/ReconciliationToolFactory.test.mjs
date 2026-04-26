import { describe, it, expect, vi } from 'vitest';

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
    loadReconciliationData: vi.fn(async () => ({
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
    loadAdjustedNutritionData: vi.fn(async () => ({
      '2026-03-23': {
        calories: 1850,
        protein: 160,
        portion_multiplier: 1.49,
        phantom_calories: 230,
      },
    })),
    loadCoachingData: vi.fn(async () => ({
      '2026-03-22': [{ message: 'old coaching', timestamp: '2026-03-22T10:00:00Z' }],
    })),
  };

  it('creates 3 tools', () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    expect(tools.length).toBe(3);
    const names = tools.map(t => t.name);
    expect(names.includes('get_reconciliation_summary')).toBeTruthy();
    expect(names.includes('get_adjusted_nutrition')).toBeTruthy();
    expect(names.includes('get_coaching_history')).toBeTruthy();
  });

  it('get_reconciliation_summary returns accuracy and days', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 30 });
    expect(result.avgAccuracy !== undefined).toBeTruthy();
    expect(result.days !== undefined).toBeTruthy();
    expect(Array.isArray(result.days)).toBeTruthy();
    expect(result.maturity_note).toBeTruthy();
    expect(result.matureDayCount !== undefined).toBeTruthy();
  });

  it('redacts implied_intake and tracking_accuracy for recent days (< 14 days old)', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 30 });

    const recent = result.days.find(d => d.date === recentDate);
    const mature = result.days.find(d => d.date === matureDate);

    // Recent day: should have tracked_calories and exercise_calories, but NOT implied_intake or tracking_accuracy
    expect(recent, 'recent day should be present').toBeTruthy();
    expect(recent.tracked_calories).toBe(580);
    expect(recent.exercise_calories).toBe(0);
    expect(recent.implied_intake).toBeUndefined();
    expect(recent.tracking_accuracy).toBeUndefined();
    expect(recent.calorie_adjustment).toBeUndefined();

    // Mature day: should have all fields
    expect(mature, 'mature day should be present').toBeTruthy();
    expect(mature.tracked_calories).toBe(1063);
    expect(mature.implied_intake).toBe(2015);
    expect(mature.tracking_accuracy).toBe(0.53);
    expect(mature.calorie_adjustment).toBe(952);
  });

  it('get_adjusted_nutrition returns adjusted data', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_adjusted_nutrition');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    expect(result.days !== undefined).toBeTruthy();
  });

  it('get_coaching_history returns past coaching', async () => {
    const factory = new ReconciliationToolFactory({ healthStore: mockHealthStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_coaching_history');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    expect(result.entries !== undefined).toBeTruthy();
  });

  it('handles errors gracefully', async () => {
    const errorStore = {
      loadReconciliationData: vi.fn(async () => { throw new Error('read fail'); }),
      loadAdjustedNutritionData: vi.fn(async () => { throw new Error('read fail'); }),
      loadCoachingData: vi.fn(async () => { throw new Error('read fail'); }),
    };
    const factory = new ReconciliationToolFactory({ healthStore: errorStore });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    expect(result.error).toBeTruthy();
  });
});
