import { describe, it, expect } from 'vitest';
import { Value } from '#domains/lifeplan/entities/Value.mjs';
import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';

describe('Value Entity', () => {
  describe('construction', () => {
    it('creates a ranked value', () => {
      const value = new Value({
        id: 'family',
        name: 'Family',
        rank: 1,
      });
      expect(value.id).toBe('family');
      expect(value.rank).toBe(1);
      expect(value.alignment).toBe('aligned');
    });

    it('tracks conflicts_with', () => {
      const value = new Value({
        id: 'achievement',
        name: 'Achievement',
        rank: 2,
        conflicts_with: ['leisure'],
      });
      expect(value.conflicts_with).toEqual(['leisure']);
    });

    it('tracks justified_by beliefs', () => {
      const value = new Value({
        id: 'fairness',
        name: 'Fairness',
        rank: 3,
        justified_by: [
          { belief: 'equality-fundamental' },
        ],
      });
      expect(value.justified_by).toHaveLength(1);
    });
  });

  describe('isAxiomatic()', () => {
    it('returns true when no justified_by', () => {
      const value = new Value({ id: 'family', name: 'Family' });
      expect(value.isAxiomatic()).toBe(true);
    });

    it('returns false when justified_by exists', () => {
      const value = new Value({
        id: 'achievement', name: 'Achievement',
        justified_by: [{ belief: 'meritocracy' }],
      });
      expect(value.isAxiomatic()).toBe(false);
    });
  });

  describe('allJustificationsRefuted()', () => {
    it('returns true when all justifying beliefs are refuted', () => {
      const value = new Value({
        id: 'achievement', name: 'Achievement',
        justified_by: [{ belief: 'meritocracy' }, { belief: 'mastery' }],
      });
      expect(value.allJustificationsRefuted(['meritocracy', 'mastery'])).toBe(true);
    });

    it('returns false when some justifications remain', () => {
      const value = new Value({
        id: 'achievement', name: 'Achievement',
        justified_by: [{ belief: 'meritocracy' }, { belief: 'mastery' }],
      });
      expect(value.allJustificationsRefuted(['meritocracy'])).toBe(false);
    });

    it('returns false for axiomatic values', () => {
      const value = new Value({ id: 'family', name: 'Family' });
      expect(value.allJustificationsRefuted(['anything'])).toBe(false);
    });
  });

  describe('alignment tracking', () => {
    it('defaults to aligned', () => {
      const value = new Value({ id: 'v1', name: 'V' });
      expect(value.alignment).toBe('aligned');
    });

    it('accepts drifting state', () => {
      const value = new Value({ id: 'v1', name: 'V', alignment: 'drifting' });
      expect(value.alignment).toBe('drifting');
    });

    it('tracks drift history', () => {
      const value = new Value({
        id: 'v1', name: 'V',
        drift_history: [
          { date: '2025-01-01', correlation: 0.45, status: 'drifting' },
        ],
      });
      expect(value.drift_history).toHaveLength(1);
    });
  });

  describe('insufficient data handling (A-3.2c)', () => {
    it('returns status insufficient_data (not reconsidering) when value ids share <2 categories', () => {
      const calc = new ValueDriftCalculator();
      const values = [
        new Value({ id: 'faith-first', name: 'Faith First', rank: 1 }),
        new Value({ id: 'deep-craft', name: 'Deep Craft', rank: 2 }),
      ]; // ids match no allocation keys
      const allocation = { health: 0.6, family: 0.4 };
      const result = calc.calculateDrift(allocation, values);
      expect(result.status).toBe('insufficient_data');
      expect(result.correlation).toBeNull();
    });

    it('returns insufficient_data when only one category overlaps', () => {
      const calc = new ValueDriftCalculator();
      const values = [
        new Value({ id: 'health', name: 'Health', rank: 1 }),
        new Value({ id: 'deep-craft', name: 'Deep Craft', rank: 2 }),
      ]; // only 'health' overlaps → Spearman undefined over 1 pair
      const allocation = { health: 0.6, family: 0.4 };
      const result = calc.calculateDrift(allocation, values);
      expect(result.status).toBe('insufficient_data');
      expect(result.correlation).toBeNull();
    });

    it('returns insufficient_data when allocation is empty', () => {
      const calc = new ValueDriftCalculator();
      const values = [
        new Value({ id: 'health', name: 'Health', rank: 1 }),
        new Value({ id: 'family', name: 'Family', rank: 2 }),
      ];
      const result = calc.calculateDrift({}, values);
      expect(result.status).toBe('insufficient_data');
      expect(result.correlation).toBeNull();
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        id: 'achievement',
        name: 'Achievement',
        rank: 2,
        description: 'Accomplishing meaningful goals',
        justified_by: [{ belief: 'meritocracy' }],
        conflicts_with: ['leisure'],
        alignment: 'drifting',
        drift_history: [{ date: '2025-01-01', correlation: 0.6 }],
      };
      const value = new Value(data);
      const restored = new Value(value.toJSON());
      expect(restored.id).toBe('achievement');
      expect(restored.rank).toBe(2);
      expect(restored.justified_by).toHaveLength(1);
      expect(restored.conflicts_with).toEqual(['leisure']);
      expect(restored.alignment).toBe('drifting');
    });
  });
});
