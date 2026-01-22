// tests/unit/domains/fitness/entities/Session.test.mjs
import { Session } from '@backend/src/1_domains/fitness/entities/Session.mjs';

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
      session.durationMs = 3600000;
      expect(session.getDurationMs()).toBe(3600000);
    });

    test('calculates duration from timestamps', () => {
      session.endTime = 1736600400000; // 1 hour later
      expect(session.getDurationMs()).toBe(3600000);
    });
  });

  describe('getDurationMinutes', () => {
    test('returns duration in minutes', () => {
      session.endTime = session.startTime + 1800000; // 30 minutes
      expect(session.getDurationMinutes()).toBe(30);
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
      session.endTime = Date.now();
      expect(session.isActive()).toBe(false);
      expect(session.isCompleted()).toBe(true);
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
      session.roster = [{ name: 'A' }, { name: 'B' }];
      expect(session.getPrimaryParticipant().name).toBe('A');
    });

    test('returns null for empty roster', () => {
      session.roster = [];
      expect(session.getPrimaryParticipant()).toBeNull();
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
      const endTs = Date.now();
      session.end(endTs);
      expect(session.endTime).toBe(endTs);
    });

    test('calculates durationMs', () => {
      session.end(session.startTime + 3600000);
      expect(session.durationMs).toBe(3600000);
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
    test('adds timeline event', () => {
      session.addEvent('equipment_change', { equipment: 'bike' });
      expect(session.timeline.events).toHaveLength(1);
      expect(session.timeline.events[0].type).toBe('equipment_change');
      expect(session.timeline.events[0].equipment).toBe('bike');
    });
  });

  describe('addSnapshot', () => {
    test('adds capture to snapshots', () => {
      session.addSnapshot({ filename: 'test.jpg', size: 1024 });
      expect(session.snapshots.captures).toHaveLength(1);
      expect(session.snapshots.updatedAt).toBeDefined();
    });
  });

  describe('getDate', () => {
    test('derives date from sessionId', () => {
      expect(session.getDate()).toBe('2026-01-11');
    });

    test('returns null for invalid sessionId', () => {
      session.sessionId = '123';
      expect(session.getDate()).toBeNull();
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
      session.endTime = session.startTime + 3600000;
      session.durationMs = 3600000;
      session.metadata = { type: 'workout' };

      const json = session.toJSON();
      const restored = Session.fromJSON(json);

      expect(restored.sessionId).toBe(session.sessionId);
      expect(restored.startTime).toBe(session.startTime);
      expect(restored.endTime).toBe(session.endTime);
      expect(restored.roster).toEqual(session.roster);
    });

    test('handles legacy id field', () => {
      const restored = Session.fromJSON({ id: '20260111120000', startTime: 123 });
      expect(restored.sessionId).toBe('20260111120000');
    });
  });

  describe('static generateSessionId', () => {
    test('generates 14-digit timestamp ID', () => {
      const id = Session.generateSessionId();
      expect(id).toMatch(/^\d{14}$/);
    });

    test('accepts Date object', () => {
      // Note: generateSessionId uses local time, not UTC
      const date = new Date(2026, 0, 11, 12, 30, 45); // Local time
      const id = Session.generateSessionId(date);
      expect(id).toBe('20260111123045');
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
});
