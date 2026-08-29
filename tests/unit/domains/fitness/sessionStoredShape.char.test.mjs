/**
 * Characterization test: the STORED SHAPE of a fitness session record.
 *
 * Every downstream reader of fitness history — session detail, the recap
 * sweep, the longitudinal widget, Strava reconciliation, the receipt printer —
 * reads the YAML this shape describes, and months of records already on disk
 * have it. Any change to `Session.toJSON()` or to the normalization
 * `SessionService.saveSession()` applies is therefore a data-compatibility
 * change, not an implementation detail.
 *
 * This file pins the shape as it stands BEFORE strength runs are logged into
 * the record (docs/_wip/plans/2026-08-11-exercise-library-implementation.md,
 * task 13). It must pass unchanged afterwards — that is the proof the strength
 * block is purely additive.
 *
 * WHY IT DRIVES SessionService AND ASSERTS ON toJSON(): the datastore writes
 * `session.toJSON()` verbatim (`YamlSessionDatastore.save` →
 * `saveYaml(path, data)`), so the entity's serialization IS the file. The
 * store is stubbed to capture that object; no filesystem is involved.
 *
 * WHY yaml.dump COMPARISON: js-yaml dumps only own enumerable properties, so
 * an entity accidentally written where a plain object belongs would dump as
 * `{}` and fail loudly. It also pins KEY ORDER, which a hand-edited YAML file
 * (this tree is Dropbox-synced and people do edit it) is diffed against.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import yaml from 'js-yaml';
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
import { dehydrateSessionRecord } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';

const HH = 'default';

/** In-memory ISessionDatastore: captures exactly what save() was handed. */
function makeStore() {
  const saved = new Map();
  return {
    saved,
    async save(session, householdId) {
      const data = dehydrateSessionRecord(session);
      saved.set(`${householdId}:${data.sessionId}`, data);
    },
    async findById(id, householdId) {
      return saved.get(`${householdId}:${id}`) ?? null;
    },
    async findByDate() { return []; },
    async delete() {},
    getStoragePaths(id) { return { sessionFilePath: `/fake/${id}.yml` }; },
  };
}

/**
 * The payload the garage kiosk actually POSTs to /save_session: v3, with the
 * human-readable `session` block, `participants` keyed by household user id,
 * root `events`, and a decoded timeline the service encodes on the way down.
 */
function v3Payload() {
  return {
    version: 3,
    session: {
      id: '20260811092020',
      date: '2026-08-11',
      start: '2026-08-11 09:20:20',
      end: '2026-08-11 09:36:38',
      duration_seconds: 978,
      source: 'garage',
    },
    timezone: 'America/Los_Angeles',
    participants: {
      'test-user': {
        display_name: 'Test User',
        is_primary: true,
        hr_device: '40475',
      },
    },
    timeline: {
      series: { 'test-user:hr': [120, 120, 121] },
      interval_seconds: 5,
      tick_count: 3,
      encoding: 'rle',
    },
    // Sent at the ROOT by the kiosk; the save path folds them into
    // timeline.events and stores them there only.
    events: [{ timestamp: 1_754_930_000_000, type: 'session_start' }],
    treasureBox: { ringTimeUnitMs: 5000, totalRings: 4 },
    summary: {
      participants: { 'test-user': { rings: 4, hr_avg: 120 } },
      media: [],
      rings: { total: 4 },
      voiceMemos: [],
    },
  };
}

describe('fitness session stored shape (characterization)', () => {
  let store;
  let service;

  const storedFor = (id) => store.saved.get(`${HH}:${id}`);

  beforeEach(() => {
    store = makeStore();
    service = new SessionService({ sessionStore: store, defaultHouseholdId: HH });
  });

  it('a v3 kiosk save stores exactly these keys, in this order', async () => {
    await service.saveSession(v3Payload(), HH);
    const stored = storedFor('20260811092020');

    expect(Object.keys(stored)).toEqual([
      'version',
      'sessionId',
      'session',
      'timezone',
      'participants',
      'timeline',
      'treasureBox',
      'summary',
    ]);
  });

  it('a v3 kiosk save stores exactly this document', async () => {
    await service.saveSession(v3Payload(), HH);

    expect(yaml.dump(storedFor('20260811092020'))).toBe(yaml.dump({
      version: 3,
      sessionId: '20260811092020',
      session: {
        id: '20260811092020',
        date: '2026-08-11',
        start: '2026-08-11 09:20:20',
        end: '2026-08-11 09:36:38',
        duration_seconds: 978,
        source: 'garage',
      },
      timezone: 'America/Los_Angeles',
      participants: {
        'test-user': {
          display_name: 'Test User',
          is_primary: true,
          hr_device: '40475',
        },
      },
      // Encoded for storage on the way down (run-length, JSON-stringified),
      // with the root events folded in.
      timeline: {
        series: { 'test-user:hr': '[[120,2],121]' },
        events: [{ timestamp: 1_754_930_000_000, type: 'session_start' }],
        interval_seconds: 5,
        tick_count: 3,
        encoding: 'rle',
      },
      treasureBox: { ringTimeUnitMs: 5000, totalRings: 4 },
      summary: {
        participants: { 'test-user': { rings: 4, hr_avg: 120 } },
        media: [],
        rings: { total: 4 },
        voiceMemos: [],
      },
    }));
  });

  it('carries no strength block today, and no key outside the known set', async () => {
    await service.saveSession(v3Payload(), HH);
    const stored = storedFor('20260811092020');

    // The pre-task-13 record has no strength block at all. After task 13 a
    // session with no strength run must still have none — an empty block on
    // every cycle ride is not additive.
    expect(stored.strength).toBeUndefined();
    expect('strength' in stored).toBe(false);

    // Nothing may appear that a downstream reader has never seen. Optional
    // blocks a v3 session CAN carry are listed so a new one shows up here.
    const KNOWN = new Set([
      'version', 'sessionId', 'session', 'timezone', 'participants',
      'startTime', 'endTime', 'durationMs', 'roster', 'timeline', 'events',
      'treasureBox', 'summary', 'strava', 'strava_notes', 'finalized',
      'provisional', 'entities', 'snapshots', 'metadata', 'timelapse',
    ]);
    expect(Object.keys(stored).filter((k) => !KNOWN.has(k))).toEqual([]);
  });

  it('a legacy (non-v3) payload keeps the root-level time and roster fields', async () => {
    await service.saveSession({
      sessionId: '20260810080000',
      startTime: 1_754_830_000_000,
      endTime: 1_754_833_600_000,
      durationMs: 3_600_000,
      roster: [{ name: 'Test User', isPrimary: true }],
      timeline: { series: {}, events: [] },
    }, HH);

    expect(yaml.dump(storedFor('20260810080000'))).toBe(yaml.dump({
      version: 3,
      sessionId: '20260810080000',
      startTime: 1_754_830_000_000,
      endTime: 1_754_833_600_000,
      durationMs: 3_600_000,
      roster: [{ name: 'Test User', isPrimary: true }],
      timeline: { series: {}, events: [] },
    }));
  });

  it('optional blocks appear only when present, and keep their position', async () => {
    const payload = v3Payload();
    payload.strava = { activityId: 19_698_457_170, name: 'Garage Ride' };
    payload.finalized = true;
    payload.snapshots = { captures: [{ filename: '0.jpg' }], updatedAt: 1_754_930_000_000 };
    payload.timelapse = { status: 'ready', videoPath: 'media/video/fitness/x.mp4' };
    await service.saveSession(payload, HH);

    expect(Object.keys(storedFor('20260811092020'))).toEqual([
      'version',
      'sessionId',
      'session',
      'timezone',
      'participants',
      'timeline',
      'treasureBox',
      'summary',
      'strava',
      'finalized',
      'snapshots',
      'timelapse',
    ]);
  });

  it('preserves the participants block verbatim — the identity path downstream reads', async () => {
    const payload = v3Payload();
    payload.participants['test-guest'] = { display_name: 'Guest', is_guest: true };
    await service.saveSession(payload, HH);

    const stored = storedFor('20260811092020');
    // Keyed by stable household id, NOT by display name. Recaps, Strava
    // reconciliation and the longitudinal widget all join on these keys.
    expect(Object.keys(stored.participants)).toEqual(['test-user', 'test-guest']);
    // `roster` is derived on READ from this block; it is not stored alongside.
    expect(stored.roster).toBeUndefined();
  });
});
