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

  describe('participants block', () => {
    it('serializes participant with derived stats', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles',
        participants: {
          kckern: {
            display_name: 'Keith',
            is_primary: true,
            is_guest: false,
            hr_device: '40475',
            cadence_device: '49904'
          }
        },
        timeline: {
          timebase: { intervalMs: 5000 },
          series: {
            'user:kckern:heart_rate': [71, 75, 80, 90, 100],
            'user:kckern:zone_id': ['c', 'c', 'a', 'a', 'a'],
            'user:kckern:coins_total': [0, 1, 2, 3, 5],
            'user:kckern:heart_beats': [5.9, 12.2, 18.9, 26.4, 34.7]
          }
        }
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.participants.kckern).toBeDefined();
      expect(result.participants.kckern.display_name).toBe('Keith');
      expect(result.participants.kckern.coins_earned).toBe(5);
      expect(result.participants.kckern.hr_stats.min).toBe(71);
      expect(result.participants.kckern.hr_stats.max).toBe(100);
      expect(result.participants.kckern.zone_time_seconds.cool).toBe(10);
      expect(result.participants.kckern.zone_time_seconds.active).toBe(15);
      expect(result.participants.kckern.total_beats).toBeCloseTo(34.7, 1);
    });
  });
});
