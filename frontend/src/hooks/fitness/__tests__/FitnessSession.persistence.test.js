import test from 'node:test';
import assert from 'node:assert/strict';
import { FitnessSession } from '../FitnessSession.js';

const baseSessionData = () => ({
  sessionId: 'fs_test',
  startTime: 1000,
  endTime: 6000,
  // Include runtime fields to ensure persistence sanitization strips them.
  roster: [{ name: 'Alice', heartRate: 120, zoneId: 'warm', isActive: true, inactiveSince: null }],
  deviceAssignments: [{ deviceId: 'dev1', occupantSlug: 'alice', occupantName: 'Alice' }],
  voiceMemos: [],
  treasureBox: null,
  timeline: {
    timebase: {
      startTime: 1000,
      intervalMs: 5000,
      tickCount: 3,
      lastTickTimestamp: 16000
    },
    series: {
      'user:alice:heart_rate': [120, 122, 124]
    },
    events: []
  }
});

test('persist rejects when user series lack device assignments', () => {
  const session = new FitnessSession();
  const data = baseSessionData();
  data.deviceAssignments = [];
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, false);
  const last = session.eventLog.at(-1);
  assert.equal(last.type, 'persist_validation_fail');
  assert.equal(last.reason, 'device-assignments-required');
});

test('persist rejects when series length mismatches tickCount', () => {
  const session = new FitnessSession();
  const data = baseSessionData();
  data.timeline.timebase.tickCount = 4;
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, false);
  const last = session.eventLog.at(-1);
  assert.equal(last.reason, 'series-tick-mismatch');
  assert.ok(Array.isArray(last.detail?.issues));
  assert.ok(last.detail.issues.length >= 1);
});

test('persist warns but saves empty numeric series', async () => {
  const session = new FitnessSession();
  let captured = null;
  session._persistApi = (_path, payload) => {
    captured = payload;
    return Promise.resolve({ ok: true });
  };
  const data = baseSessionData();
  // All-null series should be filtered (not persisted)
  data.timeline.series['device:7138:rpm'] = [null, null, null];
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(captured && captured.sessionData);

  // v2 structural fields
  assert.equal(captured.sessionData.version, 2);
  assert.ok(typeof captured.sessionData.timezone === 'string');
  assert.ok(captured.sessionData.session);
  assert.ok(captured.sessionData.participants);
  const persistedSeries = captured.sessionData.timeline.series;
  assert.equal(Object.prototype.hasOwnProperty.call(persistedSeries, 'bike:7138:rpm'), false);
});

test('persist succeeds when roster, assignments, and series are aligned', async () => {
  const session = new FitnessSession();
  let captured = null;
  session._persistApi = (_path, payload) => {
    captured = payload;
    return Promise.resolve({ ok: true });
  };
  const data = baseSessionData();
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(captured && captured.sessionData);

  // Roster is not persisted in v2 payload (realtime snapshot only).
  assert.equal(Object.prototype.hasOwnProperty.call(captured.sessionData, 'roster'), false);

  // Participants keyed object present.
  assert.ok(captured.sessionData.participants.alice);
  assert.equal(captured.sessionData.participants.alice.display_name, 'Alice');

  // Series keys are mapped in persisted payload.
  const encodedSeries = captured.sessionData.timeline.series['alice:hr'];
  assert.equal(typeof encodedSeries, 'string');

  // Compact RLE: bare values for count=1
  assert.deepEqual(JSON.parse(encodedSeries), [120, 122, 124]);
});

test('accumulates heart_beats and rotations using equipment ids', () => {
  const session = new FitnessSession();
  session.setEquipmentCatalog([{ id: 'cycle_ace', cadence: 49904 }]);

  const user = { name: 'Alice', currentData: { heartRate: 120, zone: 'warm' } };
  const device = {
    id: '49904',
    name: 'CycleAce',
    cadence: 49904,
    profile: 'heart_rate',
    getMetricsSnapshot: () => ({ rpm: 60, heartRate: 120 })
  };

  session.userManager = {
    getAllUsers: () => [user],
    resolveUserForDevice: () => user
  };
  session.deviceManager = {
    getAllDevices: () => [device]
  };

  session.ensureStarted({ force: true, reason: 'test' });
  session.timeline.reset(0, 5000);
  session.timebase.startAbsMs = 0;
  session.timebase.intervalMs = 5000;
  session.timeline.timebase.startTime = 0;
  session.timeline.timebase.intervalMs = 5000;
  session.timebase.intervalCount = 0;
  session.timebase.lastTickTimestamp = null;
  session._lastSampleIndex = -1;
  session._cumulativeBeats = new Map();
  session._cumulativeRotations = new Map();

  session._collectTimelineTick({ timestamp: 0 });
  session._collectTimelineTick({ timestamp: 5000 });

  const beats = session.timeline.series['user:alice:heart_beats'];
  const rotations = session.timeline.series['device:cycle_ace:rotations'];

  assert.deepEqual(beats.map(v => Number(v.toFixed(3))), [10, 20]);
  assert.deepEqual(rotations.map(v => Number(v.toFixed(3))), [5, 10]);

  session._stopAutosaveTimer();
  session._stopTickTimer();
});
