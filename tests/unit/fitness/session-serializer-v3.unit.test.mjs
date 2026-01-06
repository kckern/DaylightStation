import { describe, it, expect } from '@jest/globals';
import { SessionSerializerV3 } from '../../../frontend/src/hooks/fitness/SessionSerializerV3.js';

describe('SessionSerializerV3', () => {
  describe('computeDerivedStats', () => {
    it('computes HR stats from series', () => {
      const hrSeries = [71, 75, 80, 90, 100, 110, 120, 130, 125, null, null];

      const stats = SessionSerializerV3.computeHrStats(hrSeries);

      expect(stats.min).toBe(71);
      expect(stats.max).toBe(130);
      expect(stats.avg).toBe(100); // (71+75+80+90+100+110+120+130+125)/9 = 100.1 -> 100
    });

    it('computes zone time from zone series', () => {
      // 5-second intervals: 3 ticks in 'c', 2 in 'a', 1 in 'w'
      const zoneSeries = ['c', 'c', 'c', 'a', 'a', 'w'];

      const zoneTime = SessionSerializerV3.computeZoneTime(zoneSeries, 5);

      expect(zoneTime.cool).toBe(15);   // 3 * 5
      expect(zoneTime.active).toBe(10); // 2 * 5
      expect(zoneTime.warm).toBe(5);    // 1 * 5
    });

    it('computes active seconds from HR series', () => {
      // HR present at ticks 0-4, then null for ticks 5-7
      const hrSeries = [71, 75, 80, 90, 100, null, null, null];

      const activeSeconds = SessionSerializerV3.computeActiveSeconds(hrSeries, 5);

      expect(activeSeconds).toBe(25); // 5 ticks * 5 seconds
    });
  });

  describe('serializeSession', () => {
    it('creates session block with required fields', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles'
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.version).toBe(3);
      expect(result.session.id).toBe('20260106114853');
      expect(result.session.date).toBe('2026-01-06');
      expect(result.session.start).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.end).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.duration_seconds).toBe(3600);
      expect(result.session.timezone).toBe('America/Los_Angeles');
    });
  });

  describe('totals block', () => {
    it('serializes treasure box to totals', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles',
        treasureBox: {
          totalCoins: 913,
          buckets: { blue: 0, green: 270, yellow: 400, orange: 228, red: 15 }
        }
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.totals).toBeDefined();
      expect(result.totals.coins).toBe(913);
      expect(result.totals.buckets).toEqual({ blue: 0, green: 270, yellow: 400, orange: 228, red: 15 });
    });
  });
});
