import { describe, it, expect } from 'vitest';
import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';

describe('CalorieReconciliationService', () => {
  describe('computeSeedBmr', () => {
    it('computes Katch-McArdle BMR from weight and fat percent', () => {
      // 180 lbs, 20% fat → lean = 144 lbs = 65.3 kg → BMR = 370 + 21.6 * 65.3 = 1780
      const bmr = CalorieReconciliationService.computeSeedBmr(180, 20);
      expect(bmr).toBeCloseTo(1780, 0);
    });

    it('handles zero fat percent (all lean mass)', () => {
      // 180 lbs, 0% fat → lean = 180 lbs = 81.6 kg → BMR = 370 + 21.6 * 81.6 = 2133
      const bmr = CalorieReconciliationService.computeSeedBmr(180, 0);
      expect(bmr).toBeCloseTo(2133, 0);
    });

    it('returns null if weight is missing', () => {
      expect(CalorieReconciliationService.computeSeedBmr(null, 20)).toBeNull();
    });

    it('uses 25% fat as default when fat percent is missing', () => {
      // 180 lbs, 25% fat → lean = 135 lbs = 61.2 kg → BMR = 370 + 21.6 * 61.2 = 1692
      const bmr = CalorieReconciliationService.computeSeedBmr(180, null);
      expect(bmr).toBeCloseTo(1692, 0);
    });
  });

  describe('computeConfidence', () => {
    it('returns 1.0 when all signals present', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: true, hasSteps: true
      })).toBe(1.0);
    });

    it('returns 0.8 for weight + nutrition (no steps)', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: true, hasSteps: false
      })).toBe(0.8);
    });

    it('returns 0.35 for weight only', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: false, hasSteps: false
      })).toBeCloseTo(0.35);
    });

    it('returns 0 when no signals present', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: false, hasNutrition: false, hasSteps: false
      })).toBe(0);
    });
  });
});
