import { describe, it, expect } from '@jest/globals';

describe('sessionNormalizer v3 format handling', () => {
  let prepareSessionForPersistence;
  let stringifyTimelineSeriesForFile;
  let isV3Format;

  beforeAll(async () => {
    // Import the standalone helper module (no express dependency)
    const normalizer = await import('../../backend/lib/fitness/sessionNormalizer.mjs');
    prepareSessionForPersistence = normalizer.prepareSessionForPersistence;
    stringifyTimelineSeriesForFile = normalizer.stringifyTimelineSeriesForFile;
    isV3Format = normalizer.isV3Format;
  });

  describe('isV3Format', () => {
    it('returns true for valid v3 session', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'America/Los_Angeles'
        },
        totals: { coins: 100, buckets: {} },
        participants: {},
        timeline: { interval_seconds: 5, tick_count: 10, encoding: 'rle', participants: {} }
      };

      expect(isV3Format(v3Session)).toBe(true);
    });

    it('returns false for v2 session', () => {
      const v2Session = {
        sessionId: '20260106114853',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        timeline: {
          timebase: { intervalMs: 5000, tickCount: 720 },
          series: {}
        }
      };

      expect(isV3Format(v2Session)).toBe(false);
    });

    it('returns false for version 2', () => {
      const notV3 = {
        version: 2,
        session: { id: '20260106114853' }
      };

      expect(isV3Format(notV3)).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isV3Format(null)).toBe(false);
      expect(isV3Format(undefined)).toBe(false);
    });
  });

  describe('prepareSessionForPersistence', () => {
    it('passes through v3 session format with version preserved', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'America/Los_Angeles'
        },
        totals: { coins: 100, buckets: { exercise: 80, bonus: 20 } },
        participants: {
          alice: {
            display_name: 'Alice',
            is_primary: true,
            is_guest: false,
            coins_earned: 50,
            active_seconds: 1800,
            zone_time_seconds: { cool: 600, active: 600, warm: 300, hot: 300 },
            hr_stats: { min: 80, max: 165, avg: 135 }
          }
        },
        timeline: {
          interval_seconds: 5,
          tick_count: 720,
          encoding: 'rle',
          participants: {
            alice: {
              hr: '[[120,10],[130,15]]',
              zone: '[["c",10],["a",15]]'
            }
          }
        }
      };

      const result = prepareSessionForPersistence(v3Session);

      // Version should be preserved
      expect(result.version).toBe(3);

      // Session block should be preserved
      expect(result.session).toEqual(v3Session.session);

      // Totals should be preserved
      expect(result.totals).toEqual(v3Session.totals);

      // Participants should be preserved
      expect(result.participants).toEqual(v3Session.participants);

      // Timeline should be preserved with nested structure
      expect(result.timeline.interval_seconds).toBe(5);
      expect(result.timeline.tick_count).toBe(720);
      expect(result.timeline.encoding).toBe('rle');
      expect(result.timeline.participants).toEqual(v3Session.timeline.participants);
    });

    it('preserves events block in v3 format', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'America/Los_Angeles'
        },
        totals: { coins: 100, buckets: {} },
        participants: {},
        timeline: { interval_seconds: 5, tick_count: 10, encoding: 'rle', participants: {} },
        events: {
          audio: [
            {
              at: '2026-01-06 11:50:00',
              title: 'Test Song',
              artist: 'Test Artist',
              plex_id: '12345',
              duration_seconds: 180
            }
          ],
          video: [
            {
              at: '2026-01-06 12:00:00',
              title: 'Test Episode',
              show: 'Test Show',
              season: 1,
              plex_id: '67890',
              duration_seconds: 1800
            }
          ]
        }
      };

      const result = prepareSessionForPersistence(v3Session);

      // Events block should be preserved
      expect(result.events).toEqual(v3Session.events);
    });

    it('removes _persistWarnings from v3 format', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'America/Los_Angeles'
        },
        totals: { coins: 0, buckets: {} },
        participants: {},
        timeline: { interval_seconds: 5, tick_count: 0, encoding: 'rle', participants: {} },
        _persistWarnings: ['some warning']
      };

      const result = prepareSessionForPersistence(v3Session);

      // Should not have _persistWarnings
      expect(result._persistWarnings).toBeUndefined();
      // But should still have core structure
      expect(result.version).toBe(3);
      expect(result.session).toBeDefined();
    });

    it('handles v3 with equipment series', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'UTC'
        },
        totals: { coins: 0, buckets: {} },
        participants: {},
        timeline: {
          interval_seconds: 5,
          tick_count: 100,
          encoding: 'rle',
          participants: {},
          equipment: {
            bike_1: {
              cadence: '[[75,50],[80,50]]',
              power: '[[150,50],[175,50]]'
            }
          },
          global: {
            ambient_temp: '[[72,100]]'
          }
        }
      };

      const result = prepareSessionForPersistence(v3Session);

      // Equipment and global should be preserved
      expect(result.timeline.equipment).toEqual(v3Session.timeline.equipment);
      expect(result.timeline.global).toEqual(v3Session.timeline.global);
    });
  });

  describe('stringifyTimelineSeriesForFile with v3', () => {
    it('passes through v3 format unchanged', () => {
      const v3Session = {
        version: 3,
        session: {
          id: '20260106114853',
          date: '2026-01-06',
          start: '2026-01-06 11:48:53',
          end: '2026-01-06 12:48:53',
          duration_seconds: 3600,
          timezone: 'UTC'
        },
        totals: { coins: 100, buckets: {} },
        participants: {},
        timeline: {
          interval_seconds: 5,
          tick_count: 100,
          encoding: 'rle',
          participants: {
            alice: {
              hr: '[[120,50],[130,50]]'
            }
          }
        }
      };

      const result = stringifyTimelineSeriesForFile(v3Session);

      // V3 should pass through unchanged (series are already RLE-encoded strings)
      expect(result).toEqual(v3Session);
    });
  });

  describe('v2 format still works', () => {
    it('continues to normalize v2 session format', () => {
      const now = Date.now();
      const v2Session = {
        sessionId: '20260106114853',
        startTime: now - 3600000,
        endTime: now,
        timeline: {
          timebase: {
            startTime: now - 3600000,
            intervalMs: 5000,
            tickCount: 720
          },
          series: {
            'user:alice:heart_rate': [120, 125, 130]
          },
          events: []
        }
      };

      const result = prepareSessionForPersistence(v2Session);

      // v2 should be normalized as before
      expect(result.sessionId).toBe('20260106114853');
      expect(result.timeline.series).toBeDefined();
      expect(result.timebase).toBeDefined();
    });

    it('removes legacy fields from v2 format', () => {
      const v2Session = {
        sessionId: '20260106114853',
        startTime: Date.now(),
        endTime: Date.now(),
        voiceMemos: [],
        deviceAssignments: {},
        seriesMeta: {},
        _persistWarnings: [],
        timeline: {
          timebase: { intervalMs: 5000, tickCount: 10 },
          series: {}
        }
      };

      const result = prepareSessionForPersistence(v2Session);

      // Legacy fields should be removed
      expect(result.voiceMemos).toBeUndefined();
      expect(result.deviceAssignments).toBeUndefined();
      expect(result.seriesMeta).toBeUndefined();
      expect(result._persistWarnings).toBeUndefined();
    });

    it('stringifies v2 timeline series arrays', () => {
      const v2Session = {
        sessionId: '20260106114853',
        timeline: {
          series: {
            'user:alice:heart_rate': [120, 125, 130],
            'user:alice:zone_id': ['c', 'a', 'a']
          }
        }
      };

      const result = stringifyTimelineSeriesForFile(v2Session);

      // Series should be JSON stringified
      expect(typeof result.timeline.series['user:alice:heart_rate']).toBe('string');
      expect(typeof result.timeline.series['user:alice:zone_id']).toBe('string');
      expect(JSON.parse(result.timeline.series['user:alice:heart_rate'])).toEqual([120, 125, 130]);
    });
  });
});
