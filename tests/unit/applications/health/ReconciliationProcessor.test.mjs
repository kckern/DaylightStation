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
      // Measured RMR excludes digestion: resting burn = 1683 × 1.1 = 1851.
      expect(day.resting_burn).toBe(1851);
      // implied intake on this day is reproducible from the record's own fields.
      expect(day.implied_intake).toBe(Math.round(day.weight_delta_lbs * 3500 + day.resting_burn + day.exercise_calories + day.neat_calories));
    });

    it('a newer scan WITHOUT a measured RMR never shadows the DEXA anchor', async () => {
      const inbody = { date: '2026-02-01', source: 'inbody', deviceType: 'clinical_BIA', weightLbs: 176, bodyFatPercent: 24,
        leanTissueLbs: 127, fatTissueLbs: 42, bmrKcal: null, bmrMethod: null };
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore,
        bodyScans: { listScans: async () => [DEXA, inbody], getLatestScan: async () => inbody } });
      const [day] = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      expect(day.bmr_source).toBe('dexa');
    });

    it('uses the scale body fat recorded for the scan week, so both FFMs come from the scale', async () => {
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => ({ ...DEXA, scaleBodyFatPercent: 25.6 }) } });
      const [day] = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      // FFM_scan = 185.9 × 0.744 = 138.3 lb → 1622 × 140.4/138.3 ≈ 1647 (vs 1683 on the DEXA basis).
      expect(day.derived_bmr).toBe(1647);
    });

    it('falls back to the derived path when the scan store fails', async () => {
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, logger: { info() {}, warn: vi.fn(), error() {} },
        bodyScans: { getLatestScan: async () => { throw new Error('EACCES'); } } });
      const [day] = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      expect(day.bmr_source).toBe('derived');
    });

    it('counts only workout calories above the resting burn already in the anchored RMR', async () => {
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => DEXA } });
      const results = await p.process('user_1', { windowDays: 3, today: '2026-03-18' });
      // 2026-03-16: max(410 over 44 min, 400 over 45 min) gross; resting 1851/1440 per minute is removed.
      const ex = results.find(r => r.date === '2026-03-16').exercise_calories;
      expect(ex).toBeLessThan(410);
      expect(ex).toBeGreaterThan(340);
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

    it('a fully reconstructed day counts as no tracked nutrition (lower confidence)', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-03-15': { calories: 1800, reconstructed_calories: 1800 } });
      const p = new ReconciliationProcessor({ healthStore: mockHealthStore, bodyScans: { getLatestScan: async () => DEXA } });
      const day = (await p.process('user_1', { windowDays: 3, today: '2026-03-18' })).find(r => r.date === '2026-03-15');
      expect(day.tracked_calories).toBe(0);
      expect(day.tracking_confidence).toBe(0.55);
    });
  });
});

