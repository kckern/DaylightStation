/**
 * 2026-10-20 23:31:46–23:37:47 UTC: a child's strap sent ComputedHeartRate:null
 * for seven minutes. The browser held 144 bpm the whole time — TreasureBox kept
 * recording it, the zone store kept him "warm", governance counted him, and a
 * 100-ring celebration fired at 23:36:04 for a strap that was reading nothing.
 *
 * These tests pin "no reading = null everywhere": nothing accrues or counts
 * while null, the committed zone resets on loss, and the startup warm-up filter
 * applies again on every reconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logCalls = vi.hoisted(() => []);
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const record = (level) => (event, data) => { logCalls.push({ level, event, data }); };
  const logger = {
    child: () => logger,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    sampled: record('sampled'),
  };
  return { default: () => logger, getLogger: () => logger };
});

import { FitnessSession } from "./FitnessSession.js";
import { GovernanceEngine } from "./GovernanceEngine.js";

const STARTUP_DISCARD_COUNT = 3;
const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 160, color: 'orange', rings: 3 },
];
const t0 = 1_700_000_000_000;

const hr = (deviceId, bpm) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: bpm },
});
const cad = (deviceId, rpm) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'CAD', data: { CalculatedCadence: rpm },
});

function startedSession(users = [{ id: 'user_1', name: 'User_1', hr_device_id: 'hr-1' }]) {
  const session = new FitnessSession();
  session.userManager.configure({ primary: users }, ZONES);
  session.ensureStarted({ force: true, reason: 'hrReadingLoss-test' });
  session.zoneProfileStore.setBaseZoneConfig(ZONES);
  session.treasureBox.configure({ zones: ZONES });
  return session;
}

function warmUp(session, deviceId, bpm, extra = 3) {
  for (let i = 0; i < STARTUP_DISCARD_COUNT + extra; i += 1) session.ingestData(hr(deviceId, bpm));
}

const fedValues = (spy, deviceId) => spy.mock.calls
  .filter(([id]) => String(id) === deviceId)
  .map(([, value]) => value);

describe('FitnessSession — an HR strap with no reading counts for nothing', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); logCalls.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('null packets clear the user HR, stop TreasureBox scoring and drop the committed zone', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);

    const user = session.userManager.getAllUsers().find((u) => u.id === 'user_1');
    expect(user.currentData.heartRate).toBe(144);
    expect(session.zoneProfileStore.getZoneState('user_1')?.zoneId).toBe('warm');
    expect(session.treasureBox.perUser.get('user_1')?.highestZone?.id).toBe('warm');

    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    // Past HR_LOSS_GRACE_MS since the last real reading (t0).
    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(t0 + 1_000 * (i + 1));
      session.ingestData(hr('hr-1', null));
    }

    expect(session.deviceManager.getDevice('hr-1').heartRate).toBeNull();
    expect(user.currentData.heartRate).toBeNull();
    // TreasureBox is never handed a value while null — only the dropout path.
    expect(fedValues(feed, 'hr-1').every((v) => v == null)).toBe(true);
    const acc = session.treasureBox.perUser.get('user_1');
    expect(acc.highestZone).toBeNull();
    expect(acc.lastZoneId).toBeNull();
    expect(session.zoneProfileStore.getZoneState('user_1')?.zoneId).not.toBe('warm');
  });

  it('awards no rings across a ring interval of null packets', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    const before = session.treasureBox.perUser.get('user_1').totalRings || 0;
    const unit = session.treasureBox.ringTimeUnitMs;

    for (let ms = 1_000; ms <= unit * 3; ms += 1_000) {
      vi.setSystemTime(t0 + ms);
      session.ingestData(hr('hr-1', null));
      session.treasureBox.processTick(-1, new Set(['user_1']));
    }

    expect(session.treasureBox.perUser.get('user_1').totalRings || 0).toBe(before);
  });

  it('resets the committed zone once on loss, and logs one line per transition (not per packet)', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    const reset = vi.spyOn(session.zoneProfileStore, 'resetZoneState');
    logCalls.length = 0;

    for (let i = 0; i < 8; i += 1) {
      vi.setSystemTime(t0 + 1_000 * (i + 1));
      session.ingestData(hr('hr-1', null));
    }
    expect(reset.mock.calls.filter(([id]) => id === 'user_1')).toHaveLength(1);

    vi.setSystemTime(t0 + 10_000);
    for (let i = 0; i < 6; i += 1) session.ingestData(hr('hr-1', 130));

    const lost = logCalls.filter((c) => c.event === 'fitness.device.hr_reading_lost');
    const back = logCalls.filter((c) => c.event === 'fitness.device.hr_reading_restored');
    expect(lost).toHaveLength(1);
    expect(back).toHaveLength(1);
    expect(lost[0].level).toBe('info');
    expect(lost[0].data).toMatchObject({ deviceId: 'hr-1', userId: 'user_1' });
    expect(back[0].data).toMatchObject({ deviceId: 'hr-1', userId: 'user_1' });
  });

  it('a strap that stops reading while the pipeline is alive goes null on the prune tick', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    const reset = vi.spyOn(session.zoneProfileStore, 'resetZoneState');

    vi.setSystemTime(t0 + 6_000);
    session.ingestData(cad('cad-1', 70)); // another device is still delivering
    session.updateActiveDevices();

    const user = session.userManager.getAllUsers().find((u) => u.id === 'user_1');
    expect(session.deviceManager.getDevice('hr-1').heartRate).toBeNull();
    expect(user.currentData.heartRate).toBeNull();
    expect(user.currentData.hrInactive).toBe(true);
    expect(reset).toHaveBeenCalledWith('user_1');
    expect(session.treasureBox.perUser.get('user_1').highestZone).toBeNull();
  });
});

describe('FitnessSession — the startup warm-up filter applies on every reconnect', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); logCalls.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('discards the first readings again after a no-reading spell', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    for (let i = 0; i < 4; i += 1) session.ingestData(hr('hr-1', null));

    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    session.ingestData(hr('hr-1', 150));
    session.ingestData(hr('hr-1', 150));
    session.ingestData(hr('hr-1', 150));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([]);

    session.ingestData(hr('hr-1', 131));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([131]);
  });

  it('discards the first readings again after the device went inactive', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);

    vi.setSystemTime(t0 + 61_000); // silent past the inactive timeout
    session.updateActiveDevices();
    expect(session.deviceManager.getDevice('hr-1').isActive).toBe(false);

    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    for (let i = 0; i < STARTUP_DISCARD_COUNT; i += 1) session.ingestData(hr('hr-1', 150));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([]);
    session.ingestData(hr('hr-1', 132));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([132]);
  });

  it('only real readings count toward the warm-up window', () => {
    const session = startedSession();
    // A strap that wakes up sending nulls must not burn its warm-up on them.
    for (let i = 0; i < 5; i += 1) session.ingestData(hr('hr-1', null));
    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    for (let i = 0; i < STARTUP_DISCARD_COUNT; i += 1) session.ingestData(hr('hr-1', 150));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([]);
  });
});

describe('Governance — a user whose HR went null does not satisfy a zone requirement', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); logCalls.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('a stale warm reading no longer unlocks a "warm: any" rule', () => {
    const session = startedSession([
      { id: 'user_1', name: 'User_1', hr_device_id: 'hr-1' },
      { id: 'user_2', name: 'User_2', hr_device_id: 'hr-2' },
    ]);
    warmUp(session, 'hr-1', 144);
    warmUp(session, 'hr-2', 90);

    const evaluateWith = () => {
      const engine = new GovernanceEngine(session);
      engine.configure({
        governed_labels: ['governed'],
        policies: { default: { base_requirement: [{ warm: 'any' }], challenges: [] } },
        zoneConfig: ZONES,
      });
      engine.setMedia({ id: 'm1', type: 'test', labels: ['governed'] });
      const state = session.getActiveParticipantState();
      engine.evaluate({
        activeParticipants: state.participants,
        userZoneMap: state.zoneMap,
        totalCount: state.totalCount,
        hrInactiveUsers: state.hrInactiveUsers,
      });
      return { engine, state };
    };

    // Control: with a live warm reading the rule is met.
    expect(evaluateWith().engine.phase).toBe('unlocked');

    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(t0 + 1_000 * (i + 1));
      session.ingestData(hr('hr-1', null));
      session.ingestData(hr('hr-2', 90));
    }

    const { engine, state } = evaluateWith();
    expect(state.participants).not.toContain('user_1');
    expect(state.zoneMap.user_1).toBeUndefined();
    expect(engine.phase).not.toBe('unlocked');
  });
});

describe('Governance — a short no-reading blip does not drop a child', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); logCalls.length = 0; });
  afterEach(() => vi.useRealTimers());

  const evaluate = (session, engine) => {
    const state = session.getActiveParticipantState();
    engine.evaluate({
      activeParticipants: state.participants,
      userZoneMap: state.zoneMap,
      totalCount: state.totalCount,
      hrInactiveUsers: state.hrInactiveUsers,
    });
    return state;
  };

  it('a solo child stays unlocked through a 2s null blip, and is excluded once it outlasts the grace', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    const engine = new GovernanceEngine(session);
    engine.configure({
      governed_labels: ['governed'],
      policies: { default: { base_requirement: [{ warm: 'all' }], challenges: [] } },
      zoneConfig: ZONES,
    });
    engine.setMedia({ id: 'm1', type: 'test', labels: ['governed'] });
    evaluate(session, engine);
    expect(engine.phase).toBe('unlocked');

    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    for (const ms of [1_000, 2_000]) {
      vi.setSystemTime(t0 + ms);
      session.ingestData(hr('hr-1', null));
      session.updateActiveDevices();
    }
    const blip = evaluate(session, engine);
    expect(blip.participants).toContain('user_1');
    expect(engine.phase).toBe('unlocked');
    // ...but nothing accrued during the blip.
    expect(fedValues(feed, 'hr-1').every((v) => v == null)).toBe(true);
    expect(session.treasureBox.perUser.get('user_1').highestZone).toBeNull();

    for (const ms of [3_000, 4_000, 5_000, 6_000]) {
      vi.setSystemTime(t0 + ms);
      session.ingestData(hr('hr-1', null));
    }
    const sustained = evaluate(session, engine);
    expect(sustained.participants).not.toContain('user_1');
    expect(sustained.hrInactiveUsers).toContain('user_1');
  });

  it('a strap that goes silent (no packets at all) is excluded once the grace passes on a prune tick', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    session.ingestData(hr('hr-1', null));
    vi.setSystemTime(t0 + 6_000);
    session.ingestData(cad('cad-1', 70)); // pipeline alive
    session.updateActiveDevices();
    const user = session.userManager.getAllUsers().find((u) => u.id === 'user_1');
    expect(user.currentData.hrInactive).toBe(true);
  });
});

describe('FitnessSession.reset — per-device HR bookkeeping does not leak into the next session', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); logCalls.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('clears reading state and the warm-up count', () => {
    const session = startedSession();
    warmUp(session, 'hr-1', 144);
    session.reset();
    expect(session._hrReadingState.size).toBe(0);
    expect(session._deviceHrSampleCount.size).toBe(0);

    session.updateActiveDevices();
    expect(logCalls.filter((c) => c.event === 'fitness.device.hr_reading_lost')).toEqual([]);

    // reset() replaces the UserManager; configure the next session's rider.
    session.userManager.configure({ primary: [{ id: 'user_1', name: 'User_1', hr_device_id: 'hr-1' }] }, ZONES);
    session.ensureStarted({ force: true, reason: 'hrReadingLoss-test-2' });
    session.zoneProfileStore.setBaseZoneConfig(ZONES);
    session.treasureBox.configure({ zones: ZONES });
    const feed = vi.spyOn(session.treasureBox, 'recordHeartRateForDevice');
    for (let i = 0; i < STARTUP_DISCARD_COUNT; i += 1) session.ingestData(hr('hr-1', 150));
    expect(fedValues(feed, 'hr-1').filter(Number.isFinite)).toEqual([]);
  });
});
