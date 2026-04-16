import { describe, it, expect } from '@jest/globals';
import {
  resampleHR,
  deriveZones,
  deriveCoins,
  computeZoneMinutes,
  computeBuckets,
  computeHRStats,
  buildStravaSessionTimeline,
} from '#domains/fitness/services/StravaSessionBuilder.mjs';

describe('StravaSessionBuilder', () => {
  describe('resampleHR', () => {
    it('samples every 5th value from per-second data', () => {
      const perSecond = [100, 101, 102, 103, 104, 110, 111, 112, 113, 114, 120, 121, 122, 123, 124];
      expect(resampleHR(perSecond, 5)).toEqual([100, 110, 120]);
    });

    it('handles data shorter than interval', () => {
      expect(resampleHR([100, 101], 5)).toEqual([100]);
    });

    it('handles empty array', () => {
      expect(resampleHR([], 5)).toEqual([]);
    });
  });

  describe('deriveZones', () => {
    it('maps HR values to zone shortcodes', () => {
      const samples = [80, 105, 125, 145, 165];
      expect(deriveZones(samples)).toEqual(['c', 'a', 'w', 'h', 'fire']);
    });

    it('maps null to null', () => {
      expect(deriveZones([null, 120, null])).toEqual([null, 'w', null]);
    });
  });

  describe('deriveCoins', () => {
    it('accumulates coins by zone', () => {
      const samples = [80, 105, 125, 145, 165];
      expect(deriveCoins(samples)).toEqual([0, 1, 3, 6, 11]);
    });

    it('carries forward on null', () => {
      expect(deriveCoins([105, null, 125])).toEqual([1, 1, 3]);
    });
  });

  describe('computeZoneMinutes', () => {
    it('counts ticks per zone and converts to minutes', () => {
      const zones = Array(12).fill('a');
      const result = computeZoneMinutes(zones, 5);
      expect(result).toEqual({ active: 1 });
    });

    it('skips null ticks', () => {
      const zones = [null, 'a', null, 'w'];
      const result = computeZoneMinutes(zones, 5);
      expect(result.active).toBeCloseTo(0.08, 1);
      expect(result.warm).toBeCloseTo(0.08, 1);
    });
  });

  describe('computeBuckets', () => {
    it('sums coins by zone color', () => {
      const zones = ['c', 'a', 'w', 'h', 'fire'];
      expect(computeBuckets(zones)).toEqual({
        blue: 0, green: 1, yellow: 2, orange: 3, red: 5,
      });
    });
  });

  describe('computeHRStats', () => {
    it('returns avg, max, min from samples', () => {
      const stats = computeHRStats([100, 120, 140, null, 160]);
      expect(stats.hrAvg).toBe(130);
      expect(stats.hrMax).toBe(160);
      expect(stats.hrMin).toBe(100);
    });

    it('returns zeros for empty array', () => {
      expect(computeHRStats([])).toEqual({ hrAvg: 0, hrMax: 0, hrMin: 0 });
    });
  });

  describe('buildStravaSessionTimeline', () => {
    it('orchestrates full reconstruction from per-second HR', () => {
      const hrPerSecond = Array(25).fill(130);
      const result = buildStravaSessionTimeline(hrPerSecond);

      expect(result.hrSamples).toHaveLength(5);
      expect(result.zoneSeries).toHaveLength(5);
      expect(result.coinsSeries).toHaveLength(5);
      expect(result.totalCoins).toBe(10);
      expect(result.hrStats.hrAvg).toBe(130);
      expect(result.buckets.yellow).toBe(10);
      expect(result.zoneMinutes.warm).toBeCloseTo(0.42, 1);
    });

    it('returns null for empty/missing HR data', () => {
      expect(buildStravaSessionTimeline(null)).toBeNull();
      expect(buildStravaSessionTimeline([])).toBeNull();
      expect(buildStravaSessionTimeline([0])).toBeNull();
    });
  });
});
