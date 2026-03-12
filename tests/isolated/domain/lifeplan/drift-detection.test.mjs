import { describe, it, expect } from '@jest/globals';
import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';
import { Value } from '#domains/lifeplan/entities/Value.mjs';

describe('ValueDriftCalculator', () => {
  const calc = new ValueDriftCalculator();

  const values = [
    new Value({ id: 'health', name: 'Health', rank: 1 }),
    new Value({ id: 'family', name: 'Family', rank: 2 }),
    new Value({ id: 'craft', name: 'Craft', rank: 3 }),
    new Value({ id: 'adventure', name: 'Adventure', rank: 4 }),
  ];

  describe('calculateAllocation()', () => {
    it('allocates time by built-in defaults when no mapping', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              strava: [{ duration: 60, category: 'fitness' }],
              todoist: [
                { category: 'productivity' },
                { category: 'productivity' },
              ],
            },
          },
        },
      };

      const allocation = calc.calculateAllocation(lifelogRange, {}, values);
      // strava: 60 min → health, todoist: 2×15=30 min → craft
      // total 90 min: health 60/90=0.667, craft 30/90=0.333
      expect(allocation.health).toBeCloseTo(0.667, 2);
      expect(allocation.craft).toBeCloseTo(0.333, 2);
    });

    it('user category defaults override built-ins', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              todoist: [{ category: 'productivity' }],
            },
          },
        },
      };

      const mapping = { category_defaults: { productivity: 'family' } };
      const allocation = calc.calculateAllocation(lifelogRange, mapping, values);
      expect(allocation.family).toBe(1);
      expect(allocation.craft).toBeUndefined();
    });

    it('extractor overrides have highest priority', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              lastfm: [{ category: 'social' }, { category: 'social' }],
            },
          },
        },
      };

      const mapping = {
        category_defaults: { social: 'family' },
        extractor_overrides: { lastfm: 'adventure' },
      };
      const allocation = calc.calculateAllocation(lifelogRange, mapping, values);
      expect(allocation.adventure).toBe(1);
      expect(allocation.family).toBeUndefined();
    });

    it('null mapping excludes source from allocation', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              todoist: [{ category: 'productivity' }],
              reddit: [{ category: 'social' }],
            },
          },
        },
      };

      const mapping = { extractor_overrides: { reddit: null } };
      const allocation = calc.calculateAllocation(lifelogRange, mapping, values);
      expect(allocation.craft).toBe(1);
      expect(allocation.family).toBeUndefined();
    });

    it('calendar rules match by calendarName', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              calendar: [
                { calendarName: 'Work', time: '2025-06-01T09:00:00', endTime: '2025-06-01T10:00:00', category: 'calendar' },
                { calendarName: 'Family', time: '2025-06-01T18:00:00', endTime: '2025-06-01T20:00:00', category: 'calendar' },
              ],
            },
          },
        },
      };

      const mapping = {
        calendar_rules: [
          { match: { calendarName: 'Work' }, value: 'craft' },
          { match: { calendarName: 'Family' }, value: 'family' },
        ],
      };
      const allocation = calc.calculateAllocation(lifelogRange, mapping, values);
      // Work: 60 min → craft, Family: 120 min → family, total 180
      expect(allocation.craft).toBeCloseTo(60 / 180, 2);
      expect(allocation.family).toBeCloseTo(120 / 180, 2);
    });

    it('calendar rules match by summary_contains', () => {
      const lifelogRange = {
        days: {
          '2025-06-01': {
            sources: {
              calendar: [
                { summary: 'Morning gym session', time: '2025-06-01T06:00:00', endTime: '2025-06-01T07:00:00', category: 'calendar' },
              ],
            },
          },
        },
      };

      const mapping = {
        calendar_rules: [
          { match: { summary_contains: 'gym' }, value: 'health' },
        ],
      };
      const allocation = calc.calculateAllocation(lifelogRange, mapping, values);
      expect(allocation.health).toBe(1);
    });

    it('returns empty when no sources', () => {
      const lifelogRange = { days: {} };
      const allocation = calc.calculateAllocation(lifelogRange, {}, values);
      expect(Object.keys(allocation)).toHaveLength(0);
    });
  });

  describe('calculateDrift()', () => {
    it('returns aligned when allocation matches ranking (correlation > 0.8)', () => {
      // Stated: health(1), family(2), craft(3), adventure(4)
      // Observed (by proportion): health highest, then family, then craft, then adventure
      const allocation = { health: 0.4, family: 0.3, craft: 0.2, adventure: 0.1 };
      const result = calc.calculateDrift(allocation, values);
      expect(result.correlation).toBe(1);
      expect(result.status).toBe('aligned');
    });

    it('returns drifting when partially misaligned (0.5 < corr <= 0.8)', () => {
      // Swap family and craft
      const allocation = { health: 0.4, craft: 0.3, family: 0.2, adventure: 0.1 };
      const result = calc.calculateDrift(allocation, values);
      expect(result.correlation).toBeGreaterThan(0.5);
      expect(result.correlation).toBeLessThanOrEqual(0.8);
      expect(result.status).toBe('drifting');
    });

    it('returns reconsidering when heavily misaligned (corr <= 0.5)', () => {
      // Completely reversed
      const allocation = { adventure: 0.4, craft: 0.3, family: 0.2, health: 0.1 };
      const result = calc.calculateDrift(allocation, values);
      expect(result.correlation).toBeLessThanOrEqual(0.5);
      expect(result.status).toBe('reconsidering');
    });

    it('handles empty allocation', () => {
      const result = calc.calculateDrift({}, values);
      expect(result.status).toBe('reconsidering');
      expect(result.correlation).toBe(0);
    });

    it('handles empty values', () => {
      const result = calc.calculateDrift({ health: 0.5 }, []);
      expect(result.status).toBe('reconsidering');
    });
  });
});
