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

  describe('reconcile', () => {
    const seedBmr = 1700;

    it('computes implied intake from energy balance equation', () => {
      const windowData = [{
        date: '2026-03-17',
        weightDelta: -0.2,  // lost 0.2 lbs
        trackedCalories: 1800,
        exerciseCalories: 300,
        neatCalories: 250,
        hasWeight: true,
        hasNutrition: true,
        hasSteps: true,
      }];
      // implied = (-0.2 * 3500) + 1700 + 300 + 250 = -700 + 2250 = 1550
      // Uses seed BMR (< 3 high-confidence days for derived)
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      expect(results).toHaveLength(1);
      expect(results[0].implied_intake).toBe(1550);
      expect(results[0].calorie_adjustment).toBe(1550 - 1800); // -250
      expect(results[0].tracking_accuracy).toBeCloseTo(1.0); // clamped: 1800/1550 > 1
    });

    it('sets tracking_accuracy to null when implied_intake <= 0', () => {
      const windowData = [{
        date: '2026-03-17',
        weightDelta: -1.5,
        trackedCalories: 0,
        exerciseCalories: 0,
        neatCalories: 0,
        hasWeight: true,
        hasNutrition: false,
        hasSteps: false,
      }];
      // implied = (-1.5 * 3500) + 1700 + 0 + 0 = -3550
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      expect(results[0].implied_intake).toBe(-3550);
      expect(results[0].tracking_accuracy).toBeNull();
    });

    it('interpolates NEAT for days missing step data', () => {
      const windowData = [
        { date: '2026-03-15', weightDelta: 0, trackedCalories: 2000,
          exerciseCalories: 0, neatCalories: 200, hasWeight: true,
          hasNutrition: true, hasSteps: true },
        { date: '2026-03-16', weightDelta: 0, trackedCalories: 2000,
          exerciseCalories: 0, neatCalories: null, hasWeight: true,
          hasNutrition: true, hasSteps: false },
        { date: '2026-03-17', weightDelta: 0, trackedCalories: 2000,
          exerciseCalories: 0, neatCalories: 400, hasWeight: true,
          hasNutrition: true, hasSteps: true },
      ];
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      // Middle day NEAT interpolated: avg(200, 400) = 300
      expect(results[1].neat_calories).toBe(300);
    });

    it('handles extended no-logging period (all days untracked)', () => {
      const windowData = Array.from({ length: 4 }, (_, i) => ({
        date: `2026-03-${15 + i}`,
        weightDelta: 0,
        trackedCalories: 0,
        exerciseCalories: 0,
        neatCalories: 200,
        hasWeight: true,
        hasNutrition: false,
        hasSteps: true,
      }));
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      results.forEach(r => {
        expect(r.tracking_accuracy).toBe(0);
        expect(r.implied_intake).toBeGreaterThan(0);
      });
    });

    it('defaults NEAT to 0 when no step data at all', () => {
      const windowData = [{
        date: '2026-03-17',
        weightDelta: 0,
        trackedCalories: 2000,
        exerciseCalories: 0,
        neatCalories: null,
        hasWeight: true,
        hasNutrition: true,
        hasSteps: false,
      }];
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      expect(results[0].neat_calories).toBe(0);
    });

    it('computes rolling window outputs', () => {
      const windowData = Array.from({ length: 4 }, (_, i) => ({
        date: `2026-03-${15 + i}`,
        weightDelta: 0,
        trackedCalories: 2000,
        exerciseCalories: 300,
        neatCalories: 250,
        hasWeight: true,
        hasNutrition: true,
        hasSteps: true,
      }));
      const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
      const last = results[results.length - 1];
      expect(last.derived_bmr).toBeDefined();
      expect(last.maintenance_calories).toBeDefined();
      expect(last.avg_tracking_accuracy).toBeDefined();
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
