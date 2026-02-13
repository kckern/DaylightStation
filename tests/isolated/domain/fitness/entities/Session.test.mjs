// tests/unit/domains/fitness/entities/Session.test.mjs
import { Session } from '#domains/fitness/entities/Session.mjs';

describe('Session', () => {
  let session;

  beforeEach(() => {
    session = new Session({
      sessionId: '20260111120000',
      startTime: 1736596800000, // 2026-01-11T12:00:00Z in ms
      roster: [
        { name: 'John', isPrimary: true },
        { name: 'Jane', isPrimary: false }
      ]
    });
  });

  describe('constructor', () => {
    test('creates session with required fields', () => {
      expect(session.sessionId).toBe('20260111120000');
      expect(session.startTime).toBe(1736596800000);
      expect(session.endTime).toBeNull();
    });

    test('defaults empty collections', () => {
      const s = new Session({ sessionId: '20260111000000', startTime: Date.now() });
      expect(s.roster).toEqual([]);
      expect(s.timeline).toEqual({ series: {}, events: [] });
      expect(s.snapshots).toEqual({ captures: [], updatedAt: null });
    });
  });

  describe('getDurationMs', () => {
    test('returns null for active session', () => {
      expect(session.getDurationMs()).toBeNull();
    });

    test('returns stored durationMs if available', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, durationMs: 3600000 });
      expect(s.getDurationMs()).toBe(3600000);
    });

    test('calculates duration from timestamps', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, endTime: 1736600400000 });
      expect(s.getDurationMs()).toBe(3600000);
    });
  });

  describe('getDurationMinutes', () => {
    test('returns duration in minutes', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, endTime: 1736596800000 + 1800000 });
      expect(s.getDurationMinutes()).toBe(30);
    });

    test('returns null for active session', () => {
      expect(session.getDurationMinutes()).toBeNull();
    });
  });

  describe('isActive/isCompleted', () => {
    test('isActive returns true when no endTime', () => {
      expect(session.isActive()).toBe(true);
      expect(session.isCompleted()).toBe(false);
    });

    test('isCompleted returns true when endTime set', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, endTime: Date.now() });
      expect(s.isActive()).toBe(false);
      expect(s.isCompleted()).toBe(true);
    });
  });

  describe('getParticipant', () => {
    test('returns participant by name', () => {
      const p = session.getParticipant('John');
      expect(p.name).toBe('John');
    });

    test('returns null for nonexistent participant', () => {
      expect(session.getParticipant('Bob')).toBeNull();
    });
  });

  describe('getPrimaryParticipant', () => {
    test('returns primary participant', () => {
      expect(session.getPrimaryParticipant().name).toBe('John');
    });

    test('returns first participant if no primary', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, roster: [{ name: 'A' }, { name: 'B' }] });
      expect(s.getPrimaryParticipant().name).toBe('A');
    });

    test('returns null for empty roster', () => {
      const s = new Session({ sessionId: '20260111120000', startTime: 1736596800000, roster: [] });
      expect(s.getPrimaryParticipant()).toBeNull();
    });
  });

  describe('addParticipant', () => {
    test('adds new participant', () => {
      session.addParticipant({ name: 'Bob' });
      expect(session.roster).toHaveLength(3);
    });

    test('does not add duplicate', () => {
      session.addParticipant({ name: 'John' });
      expect(session.roster).toHaveLength(2);
    });
  });

  describe('removeParticipant', () => {
    test('removes participant by name', () => {
      session.removeParticipant('Jane');
      expect(session.roster).toHaveLength(1);
      expect(session.getParticipant('Jane')).toBeNull();
    });
  });

  describe('end', () => {
    test('sets endTime', () => {
      const endTs = 1736600400000;
      session.end(endTs);
      expect(session.endTime).toBe(endTs);
    });

    test('calculates durationMs', () => {
      session.end(session.startTime + 3600000);
      expect(session.durationMs).toBe(3600000);
    });

    test('throws when endTime is missing', () => {
      expect(() => session.end()).toThrow('endTime required');
    });
  });

  describe('addHeartRate', () => {
    test('adds HR value to participant series', () => {
      session.addHeartRate('John', 120);
      session.addHeartRate('John', 125);
      expect(session.timeline.series.John).toEqual([120, 125]);
    });

    test('creates series if not exists', () => {
      session.addHeartRate('NewPerson', 100);
      expect(session.timeline.series.NewPerson).toEqual([100]);
    });
  });

  describe('addEvent', () => {
    test('adds timeline event with timestamp', () => {
      const eventTime = 1736596800000;
      session.addEvent('equipment_change', { equipment: 'bike' }, eventTime);
      expect(session.timeline.events).toHaveLength(1);
      expect(session.timeline.events[0].type).toBe('equipment_change');
      expect(session.timeline.events[0].equipment).toBe('bike');
      expect(session.timeline.events[0].timestamp).toBe(eventTime);
    });

    test('throws when timestamp is missing', () => {
      expect(() => session.addEvent('test', {})).toThrow('timestamp required');
    });
  });

  describe('addSnapshot', () => {
    test('adds capture to snapshots with timestamp', () => {
      const snapshotTime = 1736596900000;
      session.addSnapshot({ filename: 'test.jpg', size: 1024 }, snapshotTime);
      expect(session.snapshots.captures).toHaveLength(1);
      expect(session.snapshots.updatedAt).toBe(snapshotTime);
    });

    test('throws when timestamp is missing', () => {
      expect(() => session.addSnapshot({ filename: 'test.jpg' })).toThrow('timestamp required');
    });
  });

  describe('getDate', () => {
    test('derives date from sessionId', () => {
      expect(session.getDate()).toBe('2026-01-11');
    });

    test('throws for invalid sessionId', () => {
      expect(() => new Session({ sessionId: '123', startTime: Date.now() })).toThrow('Invalid SessionId');
    });
  });

  describe('toSummary', () => {
    test('returns session summary', () => {
      const summary = session.toSummary();
      expect(summary.sessionId).toBe('20260111120000');
      expect(summary.startTime).toBe(1736596800000);
      expect(summary.rosterCount).toBe(2);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips session data', () => {
      const s = new Session({
        sessionId: '20260111120000',
        startTime: 1736596800000,
        endTime: 1736596800000 + 3600000,
        durationMs: 3600000,
        roster: [
          { name: 'John', isPrimary: true },
          { name: 'Jane', isPrimary: false }
        ],
        metadata: { type: 'workout' }
      });

      const json = s.toJSON();
      const restored = Session.fromJSON(json);

      expect(restored.sessionId).toBe(s.sessionId);
      expect(restored.startTime).toBe(s.startTime);
      expect(restored.endTime).toBe(s.endTime);
      expect(restored.roster).toEqual(s.roster);
    });

    test('handles legacy id field', () => {
      const restored = Session.fromJSON({ id: '20260111120000', startTime: 123 });
      expect(restored.sessionId).toBe('20260111120000');
    });
  });

  describe('static generateSessionId', () => {
    test('generates 14-digit timestamp ID from Date', () => {
      // Note: generateSessionId uses local time, not UTC
      const date = new Date(2026, 0, 11, 12, 30, 45); // Local time
      const id = Session.generateSessionId(date);
      expect(id).toMatch(/^\d{14}$/);
      expect(id).toBe('20260111123045');
    });

    test('accepts ISO date string', () => {
      const id = Session.generateSessionId('2026-01-11T12:30:45');
      expect(id).toMatch(/^\d{14}$/);
    });

    test('throws when date is missing', () => {
      expect(() => Session.generateSessionId()).toThrow('date required');
    });
  });

  describe('static isValidSessionId', () => {
    test('validates 14-digit IDs', () => {
      expect(Session.isValidSessionId('20260111120000')).toBe(true);
      expect(Session.isValidSessionId('123')).toBe(false);
      expect(Session.isValidSessionId(null)).toBe(false);
    });
  });

  describe('static sanitizeSessionId', () => {
    test('extracts digits from ID', () => {
      expect(Session.sanitizeSessionId('2026-01-11-12:00:00')).toBe('20260111120000');
    });

    test('returns null for invalid ID', () => {
      expect(Session.sanitizeSessionId('123')).toBeNull();
      expect(Session.sanitizeSessionId(null)).toBeNull();
    });
  });

  describe('v3 field preservation', () => {
    test('round-trips v3 fields through toJSON/fromJSON', () => {
      const v3Session = new Session({
        sessionId: '20260206182302',
        startTime: 1770459782635,
        endTime: 1770461372635,
        durationMs: 1590000,
        timezone: 'America/Los_Angeles',
        version: 3,
        events: [
          { at: '2026-02-06 10:23:02', type: 'media_start', data: { title: 'Workout Mix', source: 'music_player' } },
          { at: '2026-02-06 10:30:00', type: 'voice_memo', data: { transcript: 'Feeling good' } }
        ],
        participants: {
          alan: { display_name: 'Alan', is_primary: true, hr_device: '28676' }
        },
        entities: [
          { entityId: 'e1', profileId: 'alan', status: 'active', coins: 100 }
        ],
        treasureBox: { totalCoins: 313, buckets: { green: 209, yellow: 104 } },
        session: { id: '20260206182302', date: '2026-02-06', start: '2026-02-06 10:23:02' },
        roster: [{ name: 'Alan', isPrimary: true }]
      });

      const json = v3Session.toJSON();
      const restored = Session.fromJSON(json);

      // v3 fields survive round-trip
      expect(restored.version).toBe(3);
      expect(restored.events).toHaveLength(2);
      expect(restored.events[0].type).toBe('media_start');
      expect(restored.events[1].type).toBe('voice_memo');
      expect(restored.participants.alan.display_name).toBe('Alan');
      expect(restored.entities).toHaveLength(1);
      expect(restored.entities[0].coins).toBe(100);
      expect(restored.treasureBox.totalCoins).toBe(313);
      expect(restored.session.id).toBe('20260206182302');

      // Core fields: startTime/roster are NOT persisted at root in v3 —
      // they are derived from session block and participants by the infrastructure layer.
      // The entity round-trip preserves the session block and participants as canonical sources.
      expect(restored.session.start).toBe('2026-02-06 10:23:02');
      expect(restored.participants.alan.display_name).toBe('Alan');
    });

    test('toJSON omits empty v3 fields', () => {
      const minimal = new Session({
        sessionId: '20260111120000',
        startTime: 1736596800000
      });

      const json = minimal.toJSON();
      expect(json.version).toBe(3);
      expect(json.events).toBeUndefined();
      expect(json.participants).toBeUndefined();
      expect(json.entities).toBeUndefined();
      expect(json.treasureBox).toBeUndefined();
      expect(json.session).toBeUndefined();
    });
  });
});
