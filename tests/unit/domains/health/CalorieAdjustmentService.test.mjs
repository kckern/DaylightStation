import { describe, it, expect } from 'vitest';
import { CalorieAdjustmentService } from '#domains/health/services/CalorieAdjustmentService.mjs';

describe('CalorieAdjustmentService', () => {
  describe('computeWindowStats', () => {
    it('computes avg and std dev from reconciliation records', () => {
      const records = [
        { tracking_accuracy: 0.70 },
        { tracking_accuracy: 0.80 },
        { tracking_accuracy: 0.90 },
      ];
      const stats = CalorieAdjustmentService.computeWindowStats(records);
      expect(stats.avgAccuracy).toBeCloseTo(0.80, 2);
      expect(stats.stdDevAccuracy).toBeCloseTo(0.082, 2);
    });

    it('filters out null tracking_accuracy records', () => {
      const records = [
        { tracking_accuracy: 0.75 },
        { tracking_accuracy: null },
        { tracking_accuracy: 0.85 },
      ];
      const stats = CalorieAdjustmentService.computeWindowStats(records);
      expect(stats.avgAccuracy).toBeCloseTo(0.80, 2);
    });

    it('returns null stats when no valid records', () => {
      const stats = CalorieAdjustmentService.computeWindowStats([]);
      expect(stats.avgAccuracy).toBeNull();
      expect(stats.stdDevAccuracy).toBeNull();
    });
  });

  describe('computePortionMultiplier', () => {
    it('computes multiplier from tracking accuracy', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.75, 0.75, 0.10);
      expect(result.multiplier).toBeCloseTo(1.33, 1);
      expect(result.phantomNeeded).toBe(false);
    });

    it('caps multiplier at max when accuracy is very low', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.40, 0.75, 0.10);
      expect(result.multiplier).toBeCloseTo(1.54, 1);
      expect(result.maxMultiplier).toBeCloseTo(1.54, 1);
      expect(result.phantomNeeded).toBe(true);
    });

    it('floors denominator at 0.1 to prevent extreme values', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.05, 0.10, 0.15);
      expect(result.maxMultiplier).toBe(10);
      expect(result.multiplier).toBe(10);
    });

    it('returns multiplier 1.0 when accuracy is 1.0', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(1.0, 0.90, 0.05);
      expect(result.multiplier).toBe(1.0);
      expect(result.phantomNeeded).toBe(false);
    });

    it('uses avg-only when stdDev is null (insufficient data)', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.50, 0.75, null);
      expect(result.multiplier).toBeCloseTo(1.33, 1);
      expect(result.phantomNeeded).toBe(true);
    });
  });
});
