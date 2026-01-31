// tests/unit/domains/fitness/services/SessionService.test.mjs
import { jest } from '@jest/globals';
import { SessionService } from '#domains/fitness/services/SessionService.mjs';

describe('SessionService', () => {
  let service;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      save: jest.fn(),
      findById: jest.fn(),
      findByDate: jest.fn(),
      listDates: jest.fn(),
      findInRange: jest.fn(),
      findActive: jest.fn(),
      delete: jest.fn(),
      getStoragePaths: jest.fn().mockReturnValue({
        sessionDate: '2026-01-11',
        sessionsDir: '/data/sessions/2026-01-11',
        sessionFilePath: '/data/sessions/2026-01-11/20260111120000.yml',
        screenshotsDir: '/media/screenshots',
        screenshotsRelativeBase: 'screenshots'
      })
    };
    service = new SessionService({
      sessionStore: mockStore,
      defaultHouseholdId: 'default-hid'
    });
  });

  describe('resolveHouseholdId', () => {
    test('returns explicit householdId', () => {
      expect(service.resolveHouseholdId('explicit-hid')).toBe('explicit-hid');
    });

    test('falls back to default', () => {
      expect(service.resolveHouseholdId(null)).toBe('default-hid');
    });
  });

  describe('createSession', () => {
    test('creates and saves session with startTime', async () => {
      const session = await service.createSession({
        startTime: 1736596800000,
        roster: [{ name: 'John' }]
      }, 'test-hid');

      expect(session.sessionId).toMatch(/^\d{14}$/);
      expect(session.roster).toHaveLength(1);
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('uses provided sessionId and startTime', async () => {
      const session = await service.createSession({
        sessionId: '20260111100000',
        startTime: 1736586000000
      });

      expect(session.sessionId).toBe('20260111100000');
      expect(session.startTime).toBe(1736586000000);
    });

    test('throws when startTime is missing', async () => {
      await expect(service.createSession({ roster: [] }, 'test-hid'))
        .rejects.toThrow('startTime is required');
    });
  });

  describe('getSession', () => {
    test('returns session with decoded timeline', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        roster: [],
        timeline: {
          series: { John: '[[120,3]]' },
          events: []
        }
      });

      const session = await service.getSession('20260111120000', 'test-hid');
      expect(session.sessionId).toBe('20260111120000');
      expect(session.timeline.series.John).toEqual([120, 120, 120]);
    });

    test('returns null for invalid sessionId', async () => {
      const session = await service.getSession('123', 'test-hid');
      expect(session).toBeNull();
    });

    test('returns null for nonexistent session', async () => {
      mockStore.findById.mockResolvedValue(null);
      const session = await service.getSession('20260111120000', 'test-hid');
      expect(session).toBeNull();
    });
  });

  describe('listDates', () => {
    test('returns dates from store', async () => {
      mockStore.listDates.mockResolvedValue(['2026-01-11', '2026-01-10']);
      const dates = await service.listDates('test-hid');
      expect(dates).toEqual(['2026-01-11', '2026-01-10']);
    });
  });

  describe('listSessionsByDate', () => {
    test('returns session summaries', async () => {
      mockStore.findByDate.mockResolvedValue([
        { sessionId: '20260111120000', startTime: 1736596800000, roster: [] },
        { sessionId: '20260111140000', startTime: 1736604000000, roster: [{ name: 'Jane' }] }
      ]);

      const sessions = await service.listSessionsByDate('2026-01-11', 'test-hid');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('20260111120000');
      expect(sessions[1].rosterCount).toBe(1);
    });
  });

  describe('saveSession', () => {
    test('saves session with encoded timeline', async () => {
      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        timeline: {
          series: { John: [120, 120, 125] },
          events: []
        }
      }, 'test-hid');

      expect(mockStore.save).toHaveBeenCalled();
      const savedSession = mockStore.save.mock.calls[0][0];
      // Timeline should be encoded for storage
      expect(typeof savedSession.timeline.series.John).toBe('string');
    });

    test('throws for missing sessionId', async () => {
      await expect(service.saveSession({}, 'test-hid'))
        .rejects.toThrow('Valid sessionId is required');
    });

    test('preserves existing snapshots', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        snapshots: { captures: [{ filename: 'existing.jpg' }] }
      });

      const session = await service.saveSession({
        sessionId: '20260111120000',
        startTime: 1736596800000
      }, 'test-hid');

      expect(session.snapshots.captures).toHaveLength(1);
      expect(session.snapshots.captures[0].filename).toBe('existing.jpg');
    });
  });

  describe('saveSession payload normalization', () => {
    test('extracts sessionId from v3 session.id', async () => {
      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession({
        version: 3,
        session: {
          id: '20260129063322',
          date: '2026-01-29',
          start: '2026-01-29 06:33:22',
          end: '2026-01-29 07:00:00',
          duration_seconds: 1598
        },
        timeline: { series: {}, events: [] }
      }, 'test-hid');

      expect(session.sessionId.toString()).toBe('20260129063322');
    });

    test('extracts startTime from v3 session.start', async () => {
      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession({
        version: 3,
        session: {
          id: '20260129063322',
          start: '2026-01-29 06:33:22',
          end: '2026-01-29 07:00:00',
          duration_seconds: 1598
        },
        participants: {},
        timeline: {
          interval_seconds: 5,
          tick_count: 320,
          series: {}
        }
      }, 'test-hid');

      expect(session.startTime).toBeTruthy();
      expect(typeof session.startTime).toBe('number');
    });

    test('converts v3 participants object to roster array', async () => {
      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession({
        version: 3,
        session: {
          id: '20260129063322',
          start: '2026-01-29 06:33:22',
          end: '2026-01-29 07:00:00'
        },
        participants: {
          'kckern': {
            display_name: 'Kirk',
            is_primary: true,
            hr_device: 'device_40475'
          },
          'guest-1': {
            display_name: 'Guest',
            is_guest: true
          }
        },
        timeline: { series: {} }
      }, 'test-hid');

      expect(session.roster).toHaveLength(2);
      expect(session.roster.find(p => p.name === 'Kirk')).toBeTruthy();
      expect(session.roster.find(p => p.isPrimary)).toBeTruthy();
    });

    test('preserves timeline.series from v3 payload', async () => {
      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession({
        version: 3,
        session: {
          id: '20260129063322',
          start: '2026-01-29 06:33:22',
          end: '2026-01-29 07:00:00'
        },
        participants: {},
        timeline: {
          interval_seconds: 5,
          tick_count: 3,
          encoding: 'rle',
          series: {
            'kckern:hr': '[[120,2],125]',
            'kckern:zone': '[["a",3]]'
          }
        }
      }, 'test-hid');

      expect(Object.keys(session.timeline.series).length).toBeGreaterThan(0);
    });
  });

  describe('saveSession full round-trip', () => {
    test('saves complete v3 payload and retrieves with all data', async () => {
      const v3Payload = {
        version: 3,
        timezone: 'America/Los_Angeles',
        session: {
          id: '20260129063322',
          date: '2026-01-29',
          start: '2026-01-29 06:33:22',
          end: '2026-01-29 07:00:00',
          duration_seconds: 1598
        },
        participants: {
          'kckern': {
            display_name: 'Kirk',
            is_primary: true,
            hr_device: 'device_40475'
          }
        },
        timeline: {
          interval_seconds: 5,
          tick_count: 320,
          encoding: 'rle',
          series: {
            'kckern:hr': '[[120,100],[125,100],[130,120]]',
            'kckern:zone': '[["a",200],["w",120]]'
          }
        },
        events: [
          { at: '2026-01-29 06:35:00', type: 'media_start', data: { title: 'Workout Mix' } }
        ]
      };

      mockStore.findById.mockResolvedValue(null);

      const session = await service.saveSession(v3Payload, 'test-hid');

      // Verify core fields
      expect(session.sessionId.toString()).toBe('20260129063322');
      expect(session.startTime).toBeTruthy();
      expect(session.timezone).toBe('America/Los_Angeles');

      // Verify roster
      expect(session.roster).toHaveLength(1);
      expect(session.roster[0].name).toBe('Kirk');
      expect(session.roster[0].isPrimary).toBe(true);
      expect(session.roster[0].hrDeviceId).toBe('device_40475');

      // Verify timeline series were preserved (and encoded for storage)
      expect(Object.keys(session.timeline.series)).toContain('kckern:hr');
      expect(typeof session.timeline.series['kckern:hr']).toBe('string');
    });
  });

  describe('endSession', () => {
    test('ends session with provided time', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        endTime: null,
        roster: [],
        timeline: { series: {}, events: [] }
      });

      const session = await service.endSession('20260111120000', 'test-hid', 1736600400000);
      expect(session.endTime).toBe(1736600400000);
      expect(session.durationMs).toBe(3600000);
    });

    test('throws for nonexistent session', async () => {
      mockStore.findById.mockResolvedValue(null);
      await expect(service.endSession('20260111120000', 'test-hid', 1736600400000))
        .rejects.toThrow('Session not found');
    });

    test('throws when endTime is missing', async () => {
      await expect(service.endSession('20260111120000', 'test-hid'))
        .rejects.toThrow('endTime is required');
    });
  });

  describe('addParticipant', () => {
    test('adds participant to session', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        roster: [],
        timeline: { series: {}, events: [] }
      });

      const session = await service.addParticipant(
        '20260111120000',
        { name: 'Jane' },
        'test-hid'
      );
      expect(session.roster).toHaveLength(1);
      expect(session.roster[0].name).toBe('Jane');
    });
  });

  describe('addSnapshot', () => {
    test('adds snapshot to existing session', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        snapshots: { captures: [], updatedAt: null }
      });

      const snapshotTime = 1736596900000;
      const session = await service.addSnapshot(
        '20260111120000',
        { filename: 'test.jpg', size: 1024 },
        'test-hid',
        snapshotTime
      );

      expect(session.snapshots.captures).toHaveLength(1);
      expect(session.snapshots.captures[0].filename).toBe('test.jpg');
      expect(session.snapshots.updatedAt).toBe(snapshotTime);
    });

    test('removes duplicate by filename', async () => {
      mockStore.findById.mockResolvedValue({
        sessionId: '20260111120000',
        snapshots: { captures: [{ filename: 'test.jpg', size: 500 }] }
      });

      const session = await service.addSnapshot(
        '20260111120000',
        { filename: 'test.jpg', size: 1024 },
        'test-hid',
        1736596900000
      );

      expect(session.snapshots.captures).toHaveLength(1);
      expect(session.snapshots.captures[0].size).toBe(1024);
    });

    test('throws when timestamp is missing', async () => {
      await expect(service.addSnapshot('20260111120000', { filename: 'test.jpg' }, 'test-hid'))
        .rejects.toThrow('timestamp is required');
    });
  });

  describe('getActiveSessions', () => {
    test('returns active sessions', async () => {
      mockStore.findActive.mockResolvedValue([
        { sessionId: '20260111120000', startTime: 1736596800000, endTime: null, roster: [] }
      ]);

      const sessions = await service.getActiveSessions('test-hid');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].isActive()).toBe(true);
    });
  });

  describe('deleteSession', () => {
    test('deletes session', async () => {
      await service.deleteSession('20260111120000', 'test-hid');
      expect(mockStore.delete).toHaveBeenCalledWith('20260111120000', 'test-hid');
    });
  });

  describe('getStoragePaths', () => {
    test('returns storage paths from store', () => {
      const paths = service.getStoragePaths('20260111120000', 'test-hid');
      expect(paths.sessionDate).toBe('2026-01-11');
      expect(paths.screenshotsDir).toBe('/media/screenshots');
    });

    test('returns null for invalid sessionId', () => {
      const paths = service.getStoragePaths('123', 'test-hid');
      expect(paths).toBeNull();
    });
  });
});
