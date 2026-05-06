// tests/isolated/domain/health/services/MetricRegistry.test.mjs
import { describe, it, expect } from 'vitest';
import { MetricRegistry } from '../../../../../backend/src/2_domains/health/services/MetricRegistry.mjs';

describe('MetricRegistry', () => {
  describe('weight metrics', () => {
    it('weight_lbs prefers lbs_adjusted_average over lbs', () => {
      const m = MetricRegistry.get('weight_lbs');
      expect(m.read({ lbs: 200, lbs_adjusted_average: 198 })).toBe(198);
      expect(m.read({ lbs: 200 })).toBe(200);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('weight');
      expect(m.unit).toBe('lbs');
      expect(m.kind).toBe('value');
    });

    it('fat_percent prefers fat_percent_average over fat_percent', () => {
      const m = MetricRegistry.get('fat_percent');
      expect(m.read({ fat_percent: 20, fat_percent_average: 19 })).toBe(19);
      expect(m.read({ fat_percent: 20 })).toBe(20);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('weight');
    });
  });

  describe('nutrition metrics', () => {
    it('calories reads .calories', () => {
      const m = MetricRegistry.get('calories');
      expect(m.read({ calories: 2100 })).toBe(2100);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('nutrition');
    });

    it('protein_g reads .protein', () => {
      expect(MetricRegistry.get('protein_g').read({ protein: 150 })).toBe(150);
    });
    it('carbs_g reads .carbs', () => {
      expect(MetricRegistry.get('carbs_g').read({ carbs: 200 })).toBe(200);
    });
    it('fat_g reads .fat', () => {
      expect(MetricRegistry.get('fat_g').read({ fat: 70 })).toBe(70);
    });
    it('fiber_g reads .fiber', () => {
      expect(MetricRegistry.get('fiber_g').read({ fiber: 30 })).toBe(30);
    });
  });

  describe('workout metrics', () => {
    it('workout_count counts entries', () => {
      const m = MetricRegistry.get('workout_count');
      expect(m.kind).toBe('count');
      expect(m.source).toBe('workouts');
      expect(m.read([{}, {}, {}])).toBe(3);
      expect(m.read([])).toBe(0);
      expect(m.read(undefined)).toBe(0);
    });

    it('workout_duration_min sums duration', () => {
      const m = MetricRegistry.get('workout_duration_min');
      expect(m.kind).toBe('sum');
      expect(m.read([{ duration: 30 }, { duration: 45 }])).toBe(75);
      expect(m.read([{ duration: 30 }, {}])).toBe(30);
      expect(m.read([])).toBe(0);
    });

    it('workout_calories sums calories', () => {
      const m = MetricRegistry.get('workout_calories');
      expect(m.read([{ calories: 200 }, { calories: 150 }])).toBe(350);
    });
  });

  describe('density metrics', () => {
    it('tracking_density returns 1 when calories logged, 0 when not', () => {
      const m = MetricRegistry.get('tracking_density');
      expect(m.kind).toBe('ratio');
      expect(m.source).toBe('nutrition');
      expect(m.read({ calories: 1800 })).toBe(1);
      expect(m.read({ calories: 0 })).toBe(0);
      expect(m.read({})).toBe(0);
      expect(m.read(null)).toBe(0);
    });
  });

  describe('list and unknown', () => {
    it('list() returns all known metric names', () => {
      const names = MetricRegistry.list();
      expect(names).toContain('weight_lbs');
      expect(names).toContain('calories');
      expect(names).toContain('workout_count');
      expect(names).toContain('tracking_density');
    });

    it('get() throws on unknown metric', () => {
      expect(() => MetricRegistry.get('does_not_exist')).toThrow(/unknown metric/);
    });
  });
});
