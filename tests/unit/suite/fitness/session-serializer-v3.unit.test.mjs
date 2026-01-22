import { describe, it, expect } from '@jest/globals';
import { SessionSerializerV3 } from '#frontend/hooks/fitness/SessionSerializerV3.js';

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

  describe('timeline block', () => {
    it('nests series by participants/equipment/global', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles',
        timeline: {
          timebase: { intervalMs: 5000, tickCount: 5 },
          series: {
            'user:kckern:heart_rate': [71, 75, 80, 90, 100],
            'user:kckern:zone_id': ['c', 'c', 'a', 'a', 'a'],
            'user:kckern:coins_total': [0, 1, 2, 3, 5],
            'user:kckern:heart_beats': [5.9, 12.2, 18.9, 26.4, 34.7],
            'device:49904:rpm': [null, null, 60, 65, 70],
            'device:49904:rotations': [null, null, 5, 10.5, 16.3],
            'global:coins_total': [0, 1, 2, 3, 5]
          }
        }
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.timeline.interval_seconds).toBe(5);
      expect(result.timeline.tick_count).toBe(5);
      expect(result.timeline.encoding).toBe('rle');

      // Participants nested
      expect(result.timeline.participants.kckern.hr).toBeDefined();
      expect(result.timeline.participants.kckern.zone).toBeDefined();

      // Equipment nested
      expect(result.timeline.equipment['49904'].rpm).toBeDefined();

      // Global
      expect(result.timeline.global.coins).toBeDefined();
    });

    it('drops empty/trivial series', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles',
        timeline: {
          timebase: { intervalMs: 5000, tickCount: 5 },
          series: {
            'user:kckern:heart_rate': [71, 75, 80, 90, 100],
            'device:12345:power': [null, null, null, null, null],
            'device:12345:rotations': [0, 0, 0, 0, 0]
          }
        }
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.timeline.participants.kckern.hr).toBeDefined();
      expect(result.timeline.equipment).toBeUndefined(); // All nulls/zeros dropped
    });
  });

  describe('events block', () => {
    it('groups events by audio/video/voice_memos', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles',
        timeline: {
          events: [
            { type: 'media_start', timestamp: 1767729000000, data: { source: 'music_player', title: 'Song 1', artist: 'Artist', plex_id: '123', durationSeconds: 200 } },
            { type: 'media_start', timestamp: 1767730000000, data: { source: 'video_player', title: 'Video 1', show: 'Show', plex_id: '456', durationSeconds: 300 } },
            { type: 'voice_memo_start', timestamp: 1767731000000, data: { memoId: 'memo_123', durationSeconds: 60, transcriptPreview: 'Test memo' } }
          ]
        }
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.events.audio).toHaveLength(1);
      expect(result.events.audio[0].title).toBe('Song 1');
      expect(result.events.video).toHaveLength(1);
      expect(result.events.video[0].title).toBe('Video 1');
      expect(result.events.voice_memos).toHaveLength(1);
      expect(result.events.voice_memos[0].id).toBe('memo_123');
    });
  });
});
