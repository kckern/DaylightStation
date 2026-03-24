import { describe, it, expect, jest, beforeAll } from '@jest/globals';

// Mock the Logger to prevent side effects
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

// Mock DaylightAPI (imported by PersistenceManager)
jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  DaylightAPI: { post: jest.fn() }
}));

// Mock SessionSerializerV3
jest.unstable_mockModule('#frontend/hooks/fitness/SessionSerializerV3.js', () => ({
  SessionSerializerV3: class { serialize() { return {}; } }
}));

// Mock buildSessionSummary
jest.unstable_mockModule('#frontend/hooks/fitness/buildSessionSummary.js', () => ({
  buildSessionSummary: jest.fn(() => ({}))
}));

let PersistenceManager;
beforeAll(async () => {
  const mod = await import('#frontend/hooks/fitness/PersistenceManager.js');
  PersistenceManager = mod.PersistenceManager;
});

describe('PersistenceManager — validation', () => {
  it('should reject sessions where all HR series are zero', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [0, 0, 0, 0, 0, 0],
          'alice:zone': [null, null, null, null, null, null],
          'alice:coins': [0, 0, 0, 0, 0, 0],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-meaningful-data');
  });

  it('should reject sessions with no HR series at all', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:zone': ['cool', '', '', '', '', ''],
          'alice:coins': [0, 0, 0, 0, 0, 0],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-meaningful-data');
  });

  it('should drop series where every value is zero or null (mixed)', () => {
    const pm = new PersistenceManager();
    const series = {
      'alice:hr': [80, 85, 90, 88, 92, 95],           // real data — keep
      'bike:7153:rotations': [0, 0, 0, null, null],    // all zero/null — drop
      'bike:28812:rotations': [0, null, 0, null, 0],   // all zero/null — drop
      'bike:49904:rotations': [0, 0, 5, 10, 15, 20],   // has real data — keep
    };
    const { encodedSeries } = pm.encodeSeries(series);

    expect(encodedSeries).toHaveProperty('alice:hr');
    expect(encodedSeries).toHaveProperty('bike:49904:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:7153:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:28812:rotations');
  });

  it('should accept sessions with real HR data', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [120, 125, 130, 128, 132, 135],
          'alice:zone': ['active', '', '', '', '', ''],
          'alice:coins': [0, 1, 2, 3, 4, 5],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(true);
  });

  describe('_consolidateEvents — voice memo consolidation', () => {
    it('should merge voice_memo_start and voice_memo into a single event', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 120000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 60000,
              type: 'voice_memo_start',
              data: {
                memoId: 'memo_123',
                elapsedSeconds: 60,
                videoTimeSeconds: 45,
                durationSeconds: 25,
                author: 'alice',
                transcriptPreview: 'Great workout today'
              }
            },
            {
              timestamp: now - 59967,
              type: 'voice_memo',
              data: {
                memoId: 'memo_123',
                duration_seconds: 25,
                transcript: 'Great workout today'
              }
            }
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const events = sessionData.timeline.events;

      // Should have exactly one voice memo event, not two
      const voiceEvents = events.filter(e =>
        e.type === 'voice_memo' || e.type === 'voice_memo_start'
      );
      expect(voiceEvents.length).toBe(1);

      // Merged event should have fields from both
      const merged = voiceEvents[0];
      expect(merged.type).toBe('voice_memo');
      expect(merged.data.memoId).toBe('memo_123');
      expect(merged.data.transcript).toBe('Great workout today');
      expect(merged.data.duration_seconds).toBe(25);
      expect(merged.data.elapsedSeconds).toBe(60);
      expect(merged.data.videoTimeSeconds).toBe(45);
      expect(merged.data.author).toBe('alice');
    });

    it('should handle orphan voice_memo without voice_memo_start', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 120000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 30000,
              type: 'voice_memo',
              data: {
                memoId: 'memo_orphan',
                duration_seconds: 10,
                transcript: 'Orphan memo'
              }
            }
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const events = sessionData.timeline.events;

      const voiceEvents = events.filter(e => e.type === 'voice_memo');
      expect(voiceEvents.length).toBe(1);
      expect(voiceEvents[0].data.transcript).toBe('Orphan memo');
      expect(voiceEvents[0].data.elapsedSeconds).toBeNull();
    });
  });

  describe('_consolidateEvents — media blip filtering', () => {
    it('should filter out media events watched less than 30 seconds', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 600000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 100000,
              type: 'media_start',
              data: { contentId: 'plex:111', title: 'Dynamix', source: 'video_player' }
            },
            {
              timestamp: now - 98000,
              type: 'media_end',
              data: { contentId: 'plex:111', source: 'video_player' }
            },
            {
              timestamp: now - 97000,
              type: 'media_start',
              data: { contentId: 'plex:222', title: 'Total Synergistics', source: 'video_player' }
            },
            {
              timestamp: now - 1000,
              type: 'media_end',
              data: { contentId: 'plex:222', source: 'video_player' }
            },
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
      expect(mediaEvents).toHaveLength(1);
      expect(mediaEvents[0].data.contentId).toBe('plex:222');
      expect(mediaEvents[0].data.title).toBe('Total Synergistics');
    });

    it('should keep the blip if it is the only media event', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 600000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 100000,
              type: 'media_start',
              data: { contentId: 'plex:111', title: 'Dynamix', source: 'video_player' }
            },
            {
              timestamp: now - 98000,
              type: 'media_end',
              data: { contentId: 'plex:111', source: 'video_player' }
            },
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
      expect(mediaEvents).toHaveLength(1);
      expect(mediaEvents[0].data.contentId).toBe('plex:111');
    });

    it('should keep all blips when no video exceeds threshold', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 600000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 100000,
              type: 'media_start',
              data: { contentId: 'plex:111', title: 'Short A', source: 'video_player' }
            },
            {
              timestamp: now - 95000,
              type: 'media_end',
              data: { contentId: 'plex:111', source: 'video_player' }
            },
            {
              timestamp: now - 90000,
              type: 'media_start',
              data: { contentId: 'plex:222', title: 'Short B', source: 'video_player' }
            },
            {
              timestamp: now - 85000,
              type: 'media_end',
              data: { contentId: 'plex:222', source: 'video_player' }
            },
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
      expect(mediaEvents).toHaveLength(2);
    });

    it('should keep media events with no end timestamp (still playing)', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 600000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 100000,
              type: 'media_start',
              data: { contentId: 'plex:111', title: 'Blip', source: 'video_player' }
            },
            {
              timestamp: now - 98000,
              type: 'media_end',
              data: { contentId: 'plex:111', source: 'video_player' }
            },
            {
              timestamp: now - 97000,
              type: 'media_start',
              data: { contentId: 'plex:222', title: 'Workout', source: 'video_player' }
            },
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
      expect(mediaEvents).toHaveLength(1);
      expect(mediaEvents[0].data.contentId).toBe('plex:222');
    });

    it('should not filter audio tracks regardless of duration', () => {
      const pm = new PersistenceManager();
      const now = Date.now();
      const sessionData = {
        startTime: now - 600000,
        endTime: now,
        roster: [{ id: 'alice', name: 'Alice' }],
        deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
          events: [
            {
              timestamp: now - 100000,
              type: 'media_start',
              data: { contentId: 'plex:333', title: 'Song', artist: 'Artist', source: 'music_player' }
            },
            {
              timestamp: now - 95000,
              type: 'media_end',
              data: { contentId: 'plex:333', source: 'music_player' }
            },
            {
              timestamp: now - 90000,
              type: 'media_start',
              data: { contentId: 'plex:222', title: 'Workout', source: 'video_player' }
            },
            {
              timestamp: now - 1000,
              type: 'media_end',
              data: { contentId: 'plex:222', source: 'video_player' }
            },
          ]
        }
      };

      pm.validateSessionPayload(sessionData);
      const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
      expect(mediaEvents).toHaveLength(2);
    });
  });

  describe('no-participants gate — conditional on prior save success', () => {
    it('should reject empty roster when session has never saved', () => {
      const pm = new PersistenceManager();
      const payload = {
        sessionId: 'sess-never-saved',
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        roster: [],
        deviceAssignments: [],
        timeline: {
          timebase: { tickCount: 6 },
          series: {
            'bike:123:rotations': [1, 2, 3, 4, 5, 6],
          }
        }
      };

      const result = pm.validateSessionPayload(payload);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no-participants');
    });

    it('should allow empty roster when session has previously saved successfully', () => {
      const pm = new PersistenceManager();
      const sessionId = 'sess-already-saved';

      // Simulate a prior successful save
      pm.markSaveSucceeded(sessionId);

      const payload = {
        sessionId,
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        roster: [],
        deviceAssignments: [],
        timeline: {
          timebase: { tickCount: 6 },
          series: {
            'bike:123:rotations': [1, 2, 3, 4, 5, 6],
            'user:alice:heart_rate': Array(6).fill(120),
          }
        }
      };

      const result = pm.validateSessionPayload(payload);
      expect(result.ok).toBe(true);
    });

    it('should bypass roster-required when session has previously saved', () => {
      const pm = new PersistenceManager();
      const sessionId = 'sess-roster-bypass';
      pm.markSaveSucceeded(sessionId);

      const payload = {
        sessionId,
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        roster: [],
        deviceAssignments: [{ deviceId: '28688', occupantId: 'alice' }],
        timeline: {
          timebase: { tickCount: 6 },
          series: {
            'user:alice:heart_rate': [80, 85, 90, 88, 92, 95],
          }
        }
      };

      const result = pm.validateSessionPayload(payload);
      expect(result.ok).toBe(true);
    });

    it('should allow saving when deviceAssignments is empty (warns but does not block)', () => {
      const pm = new PersistenceManager();

      const payload = {
        sessionId: 'sess-no-device-assignments',
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        roster: [{ profileId: 'alice', name: 'Alice' }],
        deviceAssignments: [],
        timeline: {
          timebase: { tickCount: 6 },
          series: {
            'user:alice:heart_rate': [80, 85, 90, 88, 92, 95],
          }
        }
      };

      const result = pm.validateSessionPayload(payload);
      expect(result.ok).toBe(true);
    });

    it('should also allow saving when session has previously saved and deviceAssignments is empty', () => {
      const pm = new PersistenceManager();
      const sessionId = 'sess-device-bypass';
      pm.markSaveSucceeded(sessionId);

      const payload = {
        sessionId,
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        roster: [],
        deviceAssignments: [],
        timeline: {
          timebase: { tickCount: 6 },
          series: {
            'user:alice:heart_rate': [80, 85, 90, 88, 92, 95],
          }
        }
      };

      const result = pm.validateSessionPayload(payload);
      expect(result.ok).toBe(true);
    });
  });

  describe('debug counter reset', () => {
    it('resets debug counters via resetSession()', () => {
      const pm = new PersistenceManager();
      pm._debugBlockedCount = 3;
      pm._debugValidationCount = 3;
      pm._debugSaveCount = 5;
      pm._debugSaveSuccessCount = 3;

      pm.resetSession();

      expect(pm._debugBlockedCount).toBe(0);
      expect(pm._debugValidationCount).toBe(0);
      expect(pm._debugSaveCount).toBe(0);
      expect(pm._debugSaveSuccessCount).toBe(0);
    });

    it('clears _hasSuccessfulSave state via resetSession()', () => {
      const pm = new PersistenceManager();
      pm.markSaveSucceeded('fs_123');
      expect(pm.hasSuccessfulSave('fs_123')).toBe(true);

      pm.resetSession();

      expect(pm.hasSuccessfulSave('fs_123')).toBe(false);
    });
  });

  describe('_augmentRosterFromSeries — roster augmentation from series', () => {
    it('should include participants from series data missing from roster', () => {
      const pm = new PersistenceManager();
      const roster = [
        { profileId: 'kckern', name: 'KC Kern', isPrimary: true, hrDeviceId: '40475' }
      ];
      const seriesData = {
        'user:kckern:heart_rate': [100, 110, 120],
        'user:felix:heart_rate': [120, 130, 140],
        'user:milo:heart_rate': [130, 140, 150],
        'user:alan:heart_rate': [110, 120, 130],
        'user:soren:heart_rate': [90, 95, 100],
        'bike:40475:rotations': [0, 0, 0],  // device series — should be ignored
      };
      const deviceAssignments = [
        { deviceId: '40475', occupantId: 'kckern' },
        { deviceId: '28688', occupantId: 'felix' },
        { deviceId: '28812', occupantId: 'milo' },
      ];

      pm._augmentRosterFromSeries(roster, seriesData, deviceAssignments);

      // Should have 5 entries: kckern (original) + felix, milo, alan, soren (from series)
      expect(roster).toHaveLength(5);
      const ids = roster.map(e => e.profileId);
      expect(ids).toContain('kckern');
      expect(ids).toContain('felix');
      expect(ids).toContain('milo');
      expect(ids).toContain('alan');
      expect(ids).toContain('soren');

      // felix should have hrDeviceId from deviceAssignments
      const felix = roster.find(e => e.profileId === 'felix');
      expect(felix.hrDeviceId).toBe('28688');

      // alan should NOT have hrDeviceId (no assignment)
      const alan = roster.find(e => e.profileId === 'alan');
      expect(alan.hrDeviceId).toBeUndefined();
    });

    it('should not duplicate participants already in roster', () => {
      const pm = new PersistenceManager();
      const roster = [
        { profileId: 'alice', name: 'Alice', hrDeviceId: '123' }
      ];
      const seriesData = {
        'user:alice:heart_rate': [80, 90],
        'user:alice:zone_id': ['active', 'warm'],
      };

      pm._augmentRosterFromSeries(roster, seriesData, []);

      expect(roster).toHaveLength(1); // no duplicates
      expect(roster[0].profileId).toBe('alice');
      expect(roster[0].name).toBe('Alice'); // original entry preserved
    });

    it('should handle empty series data gracefully', () => {
      const pm = new PersistenceManager();
      const roster = [
        { profileId: 'alice', name: 'Alice' }
      ];

      pm._augmentRosterFromSeries(roster, {}, []);
      expect(roster).toHaveLength(1);

      pm._augmentRosterFromSeries(roster, null, null);
      expect(roster).toHaveLength(1);

      pm._augmentRosterFromSeries(roster, undefined, undefined);
      expect(roster).toHaveLength(1);
    });
  });
});
