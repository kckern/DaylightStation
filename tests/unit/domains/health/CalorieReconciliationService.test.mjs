import { describe, it, expect } from 'vitest';
import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';

describe('CalorieReconciliationService', () => {
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
