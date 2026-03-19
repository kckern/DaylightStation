import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReconciliationProcessor from '#apps/health/ReconciliationProcessor.mjs';

describe('ReconciliationProcessor — adjustments', () => {
  let processor;
  let mockHealthStore;
  let mockNutritionItemsReader;

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: vi.fn().mockResolvedValue({
        '2026-03-16': { lbs_adjusted_average: 170, fat_percent_adjusted_average: 22 },
        '2026-03-17': { lbs_adjusted_average: 170.1, fat_percent_adjusted_average: 22 },
        '2026-03-18': { lbs_adjusted_average: 170.0, fat_percent_adjusted_average: 22 },
      }),
      loadNutritionData: vi.fn().mockResolvedValue({
        '2026-03-17': { calories: 1200 },
        '2026-03-18': { calories: 800 },
      }),
      loadFitnessData: vi.fn().mockResolvedValue({}),
      loadActivityData: vi.fn().mockResolvedValue({}),
      loadReconciliationData: vi.fn().mockResolvedValue({}),
      saveReconciliationData: vi.fn().mockResolvedValue(undefined),
      loadAdjustedNutritionData: vi.fn().mockResolvedValue({}),
      saveAdjustedNutritionData: vi.fn().mockResolvedValue(undefined),
    };

    mockNutritionItemsReader = {
      findByDateRange: vi.fn().mockResolvedValue([
        { label: 'Chicken', grams: 150, calories: 250, protein: 47, carbs: 0, fat: 5, date: '2026-03-17' },
        { label: 'Rice', grams: 200, calories: 230, protein: 4, carbs: 50, fat: 1, date: '2026-03-17' },
        { label: 'Apple', grams: 180, calories: 95, protein: 0, carbs: 25, fat: 0, date: '2026-03-18' },
      ]),
    };

    processor = new ReconciliationProcessor({
      healthStore: mockHealthStore,
      nutritionItemsReader: mockNutritionItemsReader,
    });
  });

  it('writes adjusted nutriday after reconciliation', async () => {
    await processor.process('kckern', { windowDays: 2, today: '2026-03-19' });
    expect(mockHealthStore.saveAdjustedNutritionData).toHaveBeenCalledOnce();
    const savedData = mockHealthStore.saveAdjustedNutritionData.mock.calls[0][1];
    expect(savedData['2026-03-17']).toBeDefined();
    expect(savedData['2026-03-17'].items).toBeDefined();
    expect(savedData['2026-03-17'].adjustment_metadata).toBeDefined();
  });

  it('skips adjustment when nutritionItemsReader is not provided', async () => {
    const noReaderProcessor = new ReconciliationProcessor({ healthStore: mockHealthStore });
    await noReaderProcessor.process('kckern', { windowDays: 2, today: '2026-03-19' });
    expect(mockHealthStore.saveAdjustedNutritionData).not.toHaveBeenCalled();
  });
});
