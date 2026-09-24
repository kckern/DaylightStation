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
    const results = await processor.process('user_1', { windowDays: 3, today: '2026-03-18' });
    expect(results).toHaveLength(3);
    expect(mockHealthStore.saveReconciliationData).toHaveBeenCalledOnce();
  });

  it('merges with existing reconciliation data on save', async () => {
    mockHealthStore.loadReconciliationData.mockResolvedValue({
      '2026-03-10': { implied_intake: 2000 },
    });
    await processor.process('user_1', { windowDays: 3, today: '2026-03-18' });
    const savedData = mockHealthStore.saveReconciliationData.mock.calls[0][1];
    expect(savedData['2026-03-10']).toBeDefined(); // old data preserved
    expect(savedData['2026-03-15']).toBeDefined(); // new data added
  });

  it('throws if healthStore is missing', () => {
    expect(() => new ReconciliationProcessor({})).toThrow('healthStore');
  });

  describe('DEXA-anchored BMR', () => {
    // The real scan (BodySpec, 2025-01-15) as HealthScan exposes it (camelCase entity).
    const DEXA = { date: '2025-01-15', source: 'bodyspec_dexa', deviceType: 'DEXA', weightLbs: 185.9, bodyFatPercent: 27.2,
      leanTissueLbs: 128.7, fatTissueLbs: 50.6, bmrKcal: 1622, bmrMethod: 'measured' };

    it('anchors BMR to the measured RMR scaled by fat-free mass, never re-derived from intake', async () => {
      // Under-logged window: 1,000 tracked a day would drag a derived BMR to the clamp floor.
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-03-15': { calories: 1000 }, '2026-03-16': { calories: 1000 }, '2026-03-17': { calories: 1000 } });
      const anchored = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => DEXA } });
      const [day] = await anchored.process('user_1', { windowDays: 3, today: '2026-03-18' });
      // FFM now 180.0 × 0.78 = 140.4 lb; FFM at scan 185.9 × 0.728 = 135.3 lb → 1622 × 140.4/135.3 ≈ 1683.
      expect(day.derived_bmr).toBe(1683);
      expect(day.bmr_source).toBe('dexa');
      // implied intake includes TEF on the measured rate: 1683 × 1.1 = 1851 resting burn.
      expect(day.maintenance_calories).toBeGreaterThanOrEqual(1851);
    });

    it('ignores a scan without a MEASURED bmr', async () => {
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => ({ ...DEXA, bmrMethod: 'katch_mcardle' }) } });
      const [day] = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      expect(day.bmr_source).toBe('derived');
    });

    it('does not count reconstructed (weight-derived) calories as tracked', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-03-15': { calories: 2000, reconstructed_calories: 1400 } });
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => DEXA } });
      const results = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      expect(results.find(r => r.date === '2026-03-15').tracked_calories).toBe(600);
    });
  });
});

