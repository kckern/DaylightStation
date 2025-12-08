import test from 'node:test';
import assert from 'node:assert/strict';
import { FitnessSession } from '../FitnessSession.js';

const baseSessionData = () => ({
  sessionId: 'fs_test',
  startTime: 1000,
  endTime: 6000,
  roster: [{ name: 'Alice' }],
  deviceAssignments: [{ deviceId: 'dev1', occupantSlug: 'alice', occupantName: 'Alice' }],
  voiceMemos: [],
  treasureBox: null,
  timeline: {
    timebase: {
      startTime: 1000,
      intervalMs: 5000,
      tickCount: 2,
      lastTickTimestamp: 11000
    },
    series: {
      'user:alice:heart_rate': [120, 122]
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
  data.timeline.timebase.tickCount = 3;
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, false);
  const last = session.eventLog.at(-1);
  assert.equal(last.reason, 'series-tick-mismatch');
  assert.ok(Array.isArray(last.detail?.issues));
  assert.ok(last.detail.issues.length >= 1);
});

test('persist rejects zero-only numeric series', () => {
  const session = new FitnessSession();
  const data = baseSessionData();
  data.timeline.series['device:bike:rpm'] = [0, 0];
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, false);
  const last = session.eventLog.at(-1);
  assert.equal(last.reason, 'series-empty-signal');
  assert.equal(last.key, 'device:bike:rpm');
});

test('persist succeeds when roster, assignments, and series are aligned', async () => {
  const session = new FitnessSession();
  let called = 0;
  session._persistApi = () => {
    called += 1;
    return Promise.resolve({ ok: true });
  };
  const data = baseSessionData();
  const saved = session._persistSession(data, { force: true });
  assert.equal(saved, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, 1);
  const encodedSeries = data.timeline.series['user:alice:heart_rate'];
  assert.equal(typeof encodedSeries, 'string');
  assert.ok(data.timeline.seriesMeta['user:alice:heart_rate']);
});

test('accumulates heart_beats and rotations using equipment ids', () => {
  const session = new FitnessSession();
  session.setEquipmentCatalog([{ id: 'cycle_ace', cadence: 49904 }]);

  const user = { name: 'Alice', currentData: { heartRate: 120, zone: 'warm' } };
  const device = {
    id: '49904',
    name: 'CycleAce',
    cadence: 49904,
    getMetricsSnapshot: () => ({ rpm: 60 })
  };

  session.userManager = {
    getAllUsers: () => [user],
    resolveUserForDevice: () => null
  };
  session.deviceManager = {
    getAllDevices: () => [device]
  };

  session.ensureStarted();
  session.timeline.reset(0, 5000);
  session.timebase.startAbsMs = 0;
  session.timebase.intervalMs = 5000;
  session.timeline.timebase.startTime = 0;
  session.timeline.timebase.intervalMs = 5000;
  session.timebase.intervalCount = 0;
  session.timebase.lastTickTimestamp = null;
  session._lastSampleIndex = -1;

  session._collectTimelineTick({ timestamp: 0 });
  session._collectTimelineTick({ timestamp: 5000 });

  const beats = session.timeline.series['user:alice:heart_beats'];
  const rotations = session.timeline.series['device:cycle_ace:rotations'];

  assert.deepEqual(beats.map(v => Number(v.toFixed(3))), [10, 20]);
  assert.deepEqual(rotations.map(v => Number(v.toFixed(3))), [5, 10]);

  session._stopAutosaveTimer();
  session._stopTickTimer();
});
