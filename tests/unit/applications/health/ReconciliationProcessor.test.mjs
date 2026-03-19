import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReconciliationProcessor from '#apps/health/ReconciliationProcessor.mjs';

describe('ReconciliationProcessor', () => {
  let processor;
  let mockHealthStore;

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: vi.fn().mockResolvedValue({
        '2026-03-14': { lbs_adjusted_average: 180.5, fat_percent_adjusted_average: 22 },
        '2026-03-15': { lbs_adjusted_average: 180.3, fat_percent_adjusted_average: 22 },
        '2026-03-16': { lbs_adjusted_average: 180.1, fat_percent_adjusted_average: 22 },
        '2026-03-17': { lbs_adjusted_average: 180.0, fat_percent_adjusted_average: 22 },
      }),
      loadNutritionData: vi.fn().mockResolvedValue({
        '2026-03-15': { calories: 1900 },
        '2026-03-16': { calories: 2100 },
        '2026-03-17': { calories: 0 },
      }),
      loadFitnessData: vi.fn().mockResolvedValue({
        '2026-03-15': { steps: { calories: 250 }, activities: [] },
        '2026-03-16': { steps: { calories: 300 }, activities: [{ calories: 400, minutes: 45 }] },
        '2026-03-17': { steps: { calories: 200 }, activities: [] },
      }),
      loadActivityData: vi.fn().mockResolvedValue({
        '2026-03-16': [{ calories: 410, minutes: 44 }],
      }),
      loadReconciliationData: vi.fn().mockResolvedValue({}),
      saveReconciliationData: vi.fn().mockResolvedValue(undefined),
    };

    processor = new ReconciliationProcessor({ healthStore: mockHealthStore });
  });

  it('loads data and produces reconciliation records', async () => {
    const results = await processor.process('kckern', { windowDays: 3, today: '2026-03-18' });
    expect(results).toHaveLength(3);
    expect(mockHealthStore.saveReconciliationData).toHaveBeenCalledOnce();
  });

  it('merges with existing reconciliation data on save', async () => {
    mockHealthStore.loadReconciliationData.mockResolvedValue({
      '2026-03-10': { implied_intake: 2000 },
    });
    await processor.process('kckern', { windowDays: 3, today: '2026-03-18' });
    const savedData = mockHealthStore.saveReconciliationData.mock.calls[0][1];
    expect(savedData['2026-03-10']).toBeDefined(); // old data preserved
    expect(savedData['2026-03-15']).toBeDefined(); // new data added
  });

  it('throws if healthStore is missing', () => {
    expect(() => new ReconciliationProcessor({})).toThrow('healthStore');
  });
});
