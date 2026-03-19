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

  describe('deriveRollingBmr', () => {
    const seedBmr = 1700;

    it('returns seed BMR when no high-confidence days', () => {
      const days = [
        { confidence: 0.35, solvedBmr: null },
        { confidence: 0.35, solvedBmr: null },
      ];
      const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
      expect(result.derivedBmr).toBe(seedBmr);
      expect(result.highConfidenceDayCount).toBe(0);
    });

    it('averages solved BMR from high-confidence days', () => {
      const days = [
        { confidence: 0.8, solvedBmr: 1650 },
        { confidence: 1.0, solvedBmr: 1750 },
        { confidence: 1.0, solvedBmr: 1700 },
        { confidence: 0.35, solvedBmr: null },
      ];
      const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
      expect(result.derivedBmr).toBe(1700);
      expect(result.highConfidenceDayCount).toBe(3);
    });

    it('falls back to seed when fewer than 3 high-confidence days', () => {
      const days = [
        { confidence: 0.8, solvedBmr: 1650 },
        { confidence: 0.8, solvedBmr: 1750 },
      ];
      const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
      expect(result.derivedBmr).toBe(seedBmr);
    });

    it('clamps derived BMR to ±30% of seed', () => {
      const days = [
        { confidence: 1.0, solvedBmr: 500 },
        { confidence: 1.0, solvedBmr: 500 },
        { confidence: 1.0, solvedBmr: 500 },
      ];
      const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
      expect(result.derivedBmr).toBe(Math.round(seedBmr * 0.7)); // 1190
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
