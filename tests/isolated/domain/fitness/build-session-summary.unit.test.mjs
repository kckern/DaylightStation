import { describe, it, expect } from 'vitest';
import { buildSessionSummary } from '#frontend/hooks/fitness/buildSessionSummary.js';

describe('buildSessionSummary', () => {
  // ---------- helpers ----------
  const makeInput = (overrides = {}) => ({
    participants: { alan: 'Alan' },
    series: {
      'user:alan:heart_rate': [80, 90, 100, 110, 120],
      'user:alan:zone_id': ['c', 'c', 'a', 'a', 'w'],
      'user:alan:coins_total': [0, 2, 5, 9, 14],
    },
    events: [],
    treasureBox: { totalCoins: 14, buckets: { blue: 0, green: 4, yellow: 6, orange: 4, red: 0 } },
    intervalSeconds: 5,
    ...overrides,
  });

  // ========================================================
  // Per-participant HR stats
  // ========================================================
  describe('participant HR stats', () => {
    it('computes avg, max, min from series data', () => {
      const result = buildSessionSummary(makeInput());
      const alan = result.participants.alan;

      expect(alan.hr_avg).toBe(100);   // (80+90+100+110+120)/5 = 100
      expect(alan.hr_max).toBe(120);
      expect(alan.hr_min).toBe(80);
    });

    it('returns zeroes when HR series is missing', () => {
      const result = buildSessionSummary(makeInput({
        series: {
          'user:alan:zone_id': ['c', 'a'],
          'user:alan:coins_total': [0, 3],
        },
      }));
      const alan = result.participants.alan;

      expect(alan.hr_avg).toBe(0);
      expect(alan.hr_max).toBe(0);
      expect(alan.hr_min).toBe(0);
    });
  });

  // ========================================================
  // Per-participant coins from final cumulative value
  // ========================================================
  describe('participant coins', () => {
    it('extracts coins from final cumulative value', () => {
      const result = buildSessionSummary(makeInput());
      expect(result.participants.alan.coins).toBe(14);
    });

    it('returns 0 when coins series is missing', () => {
      const result = buildSessionSummary(makeInput({
        series: {
          'user:alan:heart_rate': [80, 90],
          'user:alan:zone_id': ['c', 'a'],
        },
      }));
      expect(result.participants.alan.coins).toBe(0);
    });
  });

  // ========================================================
  // Zone minutes per participant
  // ========================================================
  describe('zone minutes', () => {
    it('converts zone seconds to minutes rounded to 2 decimal places', () => {
      // 2 ticks cool (10s), 2 ticks active (10s), 1 tick warm (5s)
      const result = buildSessionSummary(makeInput());
      const zm = result.participants.alan.zone_minutes;

      expect(zm.cool).toBeCloseTo(10 / 60, 2);     // 0.17
      expect(zm.active).toBeCloseTo(10 / 60, 2);    // 0.17
      expect(zm.warm).toBeCloseTo(5 / 60, 2);       // 0.08
    });

    it('returns empty object when zone series is missing', () => {
      const result = buildSessionSummary(makeInput({
        series: {
          'user:alan:heart_rate': [80, 90],
          'user:alan:coins_total': [0, 3],
        },
      }));
      expect(result.participants.alan.zone_minutes).toEqual({});
    });
  });

  // ========================================================
  // Compact key format (slug:hr, slug:zone, slug:coins)
  // ========================================================
  describe('compact series key format', () => {
    it('reads HR, zone, coins from compact keys', () => {
      const result = buildSessionSummary(makeInput({
        series: {
          'alan:hr': [70, 80, 90],
          'alan:zone': ['a', 'a', 'w'],
          'alan:coins': [0, 5, 12],
        },
      }));
      const alan = result.participants.alan;

      expect(alan.hr_avg).toBe(80);
      expect(alan.hr_max).toBe(90);
      expect(alan.hr_min).toBe(70);
      expect(alan.coins).toBe(12);
      expect(alan.zone_minutes.active).toBeCloseTo(10 / 60, 2);
      expect(alan.zone_minutes.warm).toBeCloseTo(5 / 60, 2);
    });
  });

  // ========================================================
  // v2 key format (user:slug:heart_rate, etc.)
  // ========================================================
  describe('v2 series key format', () => {
    it('reads HR, zone, coins from v2 keys', () => {
      const result = buildSessionSummary(makeInput({
        series: {
          'user:alan:heart_rate': [100, 120, 140],
          'user:alan:zone_id': ['w', 'h', 'h'],
          'user:alan:coins_total': [0, 8, 20],
        },
      }));
      const alan = result.participants.alan;

      expect(alan.hr_avg).toBe(120);
      expect(alan.hr_max).toBe(140);
      expect(alan.hr_min).toBe(100);
      expect(alan.coins).toBe(20);
      expect(alan.zone_minutes.warm).toBeCloseTo(5 / 60, 2);
      expect(alan.zone_minutes.hot).toBeCloseTo(10 / 60, 2);
    });
  });

  // ========================================================
  // Multi-participant
  // ========================================================
  describe('multiple participants', () => {
    it('builds stats for each participant independently', () => {
      const result = buildSessionSummary({
        participants: { alan: 'Alan', beth: 'Beth' },
        series: {
          'user:alan:heart_rate': [80, 100],
          'user:alan:zone_id': ['c', 'a'],
          'user:alan:coins_total': [0, 5],
          'user:beth:heart_rate': [110, 130],
          'user:beth:zone_id': ['w', 'h'],
          'user:beth:coins_total': [0, 8],
        },
        events: [],
        treasureBox: { totalCoins: 13, buckets: {} },
        intervalSeconds: 5,
      });

      expect(result.participants.alan.hr_avg).toBe(90);
      expect(result.participants.beth.hr_avg).toBe(120);
      expect(result.participants.alan.coins).toBe(5);
      expect(result.participants.beth.coins).toBe(8);
    });
  });

  // ========================================================
  // Media events with primary flag
  // ========================================================
  describe('media events', () => {
    it('extracts media events and marks longest as primary', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          {
            type: 'media',
            timestamp: 1000,
            data: {
              mediaId: 'vid1',
              title: 'Episode One',
              grandparentTitle: 'The Show',
              parentTitle: 'Season 1',
              grandparentId: 'gp1',
              parentId: 'p1',
              start: 1000,
              end: 2800000, // 2800s
            },
          },
          {
            type: 'media',
            timestamp: 3000000,
            data: {
              mediaId: 'vid2',
              title: 'Episode Two',
              grandparentTitle: 'The Show',
              parentTitle: 'Season 1',
              grandparentId: 'gp1',
              parentId: 'p1',
              start: 3000000,
              end: 4000000, // 1000s
            },
          },
        ],
      }));

      expect(result.media).toHaveLength(2);

      const vid1 = result.media.find(m => m.mediaId === 'vid1');
      const vid2 = result.media.find(m => m.mediaId === 'vid2');

      expect(vid1.primary).toBe(true);
      expect(vid2.primary).toBeUndefined();

      expect(vid1.title).toBe('Episode One');
      expect(vid1.showTitle).toBe('The Show');
      expect(vid1.seasonTitle).toBe('Season 1');
      expect(vid1.grandparentId).toBe('gp1');
      expect(vid1.parentId).toBe('p1');
      expect(vid1.durationMs).toBe(2799000);
    });

    it('returns empty array when no media events', () => {
      const result = buildSessionSummary(makeInput({ events: [] }));
      expect(result.media).toEqual([]);
    });

    it('handles single media event as primary', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          {
            type: 'media',
            timestamp: 1000,
            data: {
              mediaId: 'vid1',
              title: 'Solo Video',
              grandparentTitle: 'Show',
              parentTitle: 'S1',
              grandparentId: 'gp1',
              parentId: 'p1',
              start: 1000,
              end: 5000,
            },
          },
        ],
      }));

      expect(result.media).toHaveLength(1);
      expect(result.media[0].primary).toBe(true);
    });
  });

  // ========================================================
  // Coins total and buckets from treasureBox
  // ========================================================
  describe('coins from treasureBox', () => {
    it('extracts totalCoins and buckets', () => {
      const result = buildSessionSummary(makeInput());

      expect(result.coins.total).toBe(14);
      expect(result.coins.buckets).toEqual({ blue: 0, green: 4, yellow: 6, orange: 4, red: 0 });
    });

    it('returns zero total and empty buckets when treasureBox is missing', () => {
      const result = buildSessionSummary(makeInput({ treasureBox: undefined }));

      expect(result.coins.total).toBe(0);
      expect(result.coins.buckets).toEqual({});
    });
  });

  // ========================================================
  // Challenge counts
  // ========================================================
  describe('challenge counts', () => {
    it('counts total, succeeded, and failed challenges', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          { type: 'challenge', data: { result: 'success' } },
          { type: 'challenge', data: { result: 'success' } },
          { type: 'challenge', data: { result: 'fail' } },
          { type: 'challenge', data: { result: 'fail' } },
          { type: 'challenge', data: { result: 'fail' } },
        ],
      }));

      expect(result.challenges.total).toBe(5);
      expect(result.challenges.succeeded).toBe(2);
      expect(result.challenges.failed).toBe(3);
    });

    it('returns all zeroes when no challenge events', () => {
      const result = buildSessionSummary(makeInput({ events: [] }));

      expect(result.challenges.total).toBe(0);
      expect(result.challenges.succeeded).toBe(0);
      expect(result.challenges.failed).toBe(0);
    });
  });

  // ========================================================
  // Voice memo extraction with transcript
  // ========================================================
  describe('voice memos', () => {
    it('extracts voice memos with transcript, duration, timestamp', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          {
            type: 'voice_memo',
            timestamp: 1234567890,
            data: {
              transcript: 'Great workout today',
              durationSeconds: 15,
            },
          },
          {
            type: 'voice_memo',
            timestamp: 1234568000,
            data: {
              transcript: 'Feeling strong',
              durationSeconds: 8,
            },
          },
        ],
      }));

      expect(result.voiceMemos).toHaveLength(2);
      expect(result.voiceMemos[0]).toEqual({
        transcript: 'Great workout today',
        durationSeconds: 15,
        timestamp: 1234567890,
      });
      expect(result.voiceMemos[1]).toEqual({
        transcript: 'Feeling strong',
        durationSeconds: 8,
        timestamp: 1234568000,
      });
    });

    it('returns empty array when no voice memos', () => {
      const result = buildSessionSummary(makeInput({ events: [] }));
      expect(result.voiceMemos).toEqual([]);
    });

    it('handles alternate field names (duration_seconds, transcriptPreview)', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          {
            type: 'voice_memo',
            timestamp: 1111111111,
            data: {
              transcriptPreview: 'Fallback transcript',
              duration_seconds: 22,
            },
          },
        ],
      }));

      expect(result.voiceMemos).toHaveLength(1);
      expect(result.voiceMemos[0]).toEqual({
        transcript: 'Fallback transcript',
        durationSeconds: 22,
        timestamp: 1111111111,
      });
    });
  });

  // ========================================================
  // Empty / missing data edge cases
  // ========================================================
  describe('empty/missing data', () => {
    it('handles empty participants object', () => {
      const result = buildSessionSummary(makeInput({
        participants: {},
        series: {},
      }));

      expect(result.participants).toEqual({});
    });

    it('handles null/undefined series', () => {
      const result = buildSessionSummary(makeInput({
        series: undefined,
      }));
      const alan = result.participants.alan;

      expect(alan.hr_avg).toBe(0);
      expect(alan.hr_max).toBe(0);
      expect(alan.hr_min).toBe(0);
      expect(alan.coins).toBe(0);
      expect(alan.zone_minutes).toEqual({});
    });

    it('handles null/undefined events', () => {
      const result = buildSessionSummary(makeInput({ events: undefined }));

      expect(result.media).toEqual([]);
      expect(result.challenges).toEqual({ total: 0, succeeded: 0, failed: 0 });
      expect(result.voiceMemos).toEqual([]);
    });

    it('returns all sections even with completely empty input', () => {
      const result = buildSessionSummary({
        participants: {},
        series: {},
        events: [],
        treasureBox: null,
        intervalSeconds: 5,
      });

      expect(result).toHaveProperty('participants');
      expect(result).toHaveProperty('media');
      expect(result).toHaveProperty('coins');
      expect(result).toHaveProperty('challenges');
      expect(result).toHaveProperty('voiceMemos');
    });
  });

  // ========================================================
  // Mixed event types in single events array
  // ========================================================
  describe('mixed event types', () => {
    it('correctly separates media, challenges, and voice memos from the same events array', () => {
      const result = buildSessionSummary(makeInput({
        events: [
          { type: 'media', timestamp: 1000, data: { mediaId: 'v1', title: 'Ep1', grandparentTitle: 'S', parentTitle: 'S1', grandparentId: 'g1', parentId: 'p1', start: 1000, end: 2000 } },
          { type: 'challenge', data: { result: 'success' } },
          { type: 'voice_memo', timestamp: 5000, data: { transcript: 'note', durationSeconds: 5 } },
          { type: 'challenge', data: { result: 'fail' } },
        ],
      }));

      expect(result.media).toHaveLength(1);
      expect(result.challenges.total).toBe(2);
      expect(result.challenges.succeeded).toBe(1);
      expect(result.challenges.failed).toBe(1);
      expect(result.voiceMemos).toHaveLength(1);
    });
  });
});
