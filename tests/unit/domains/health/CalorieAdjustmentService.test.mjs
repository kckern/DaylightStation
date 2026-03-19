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

  describe('adjustDayItems', () => {
    it('scales grams and all macros proportionally', () => {
      const items = [{
        label: 'Chicken Breast', grams: 150, calories: 250, protein: 47,
        carbs: 0, fat: 5, fiber: 0, sugar: 0, sodium: 100, cholesterol: 80, color: 'yellow',
      }];
      const adjusted = CalorieAdjustmentService.adjustDayItems(items, 1.33);
      expect(adjusted[0].grams).toBe(200);
      expect(adjusted[0].calories).toBe(333);
      expect(adjusted[0].protein).toBe(63);
      expect(adjusted[0].adjusted).toBe(true);
      expect(adjusted[0].original_grams).toBe(150);
    });

    it('returns items unchanged when multiplier is 1.0', () => {
      const items = [{ label: 'Apple', grams: 180, calories: 95, protein: 0, carbs: 25, fat: 0 }];
      const adjusted = CalorieAdjustmentService.adjustDayItems(items, 1.0);
      expect(adjusted[0].grams).toBe(180);
      expect(adjusted[0].adjusted).toBeUndefined();
    });

    it('handles empty items array', () => {
      expect(CalorieAdjustmentService.adjustDayItems([], 1.5)).toEqual([]);
    });
  });

  describe('computePhantomEntry', () => {
    it('creates phantom entry with macro split from day ratios', () => {
      const ratios = { proteinRatio: 0.30, carbsRatio: 0.40, fatRatio: 0.30 };
      const phantom = CalorieAdjustmentService.computePhantomEntry(500, ratios);
      expect(phantom.label).toBe('Estimated Untracked Intake');
      expect(phantom.calories).toBe(500);
      expect(phantom.protein).toBe(38);
      expect(phantom.carbs).toBe(50);
      expect(phantom.fat).toBe(17);
      expect(phantom.phantom).toBe(true);
    });

    it('uses default 30/40/30 split when ratios are null', () => {
      const phantom = CalorieAdjustmentService.computePhantomEntry(300, null);
      expect(phantom.protein).toBe(23);
      expect(phantom.carbs).toBe(30);
      expect(phantom.fat).toBe(10);
    });

    it('returns null when gap is zero or negative', () => {
      expect(CalorieAdjustmentService.computePhantomEntry(0, null)).toBeNull();
      expect(CalorieAdjustmentService.computePhantomEntry(-50, null)).toBeNull();
    });
  });
});
