import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const logged = vi.hoisted(() => []);
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const record = (event, data) => logged.push({ event, data });
  const logger = { child: () => logger, debug: () => {}, sampled: () => {}, info: record, warn: record, error: record };
  return { default: () => logger };
});

const POLICY = {
  governed_labels: ['cardio'], grace_period_seconds: 1,
  policies: { default: { name: 'Default', base_requirement: [{ active: 'all' }],
    challenges: [{ interval: [1, 1], selections: [{ type: 'cycle', equipment: 'cycle_ace',
      hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [60, 60],
      ramp_seconds: [5, 5], init: { min_rpm: 30, time_allowed_seconds: 10 },
      lo_rpm_ratio: 0.5, time_allowed: 999 }] }] } }
};
const fresh = (now, rpm = 80) => ({ rpm, connected: true, ts: now });
function fixture({ manual = true, governed = true } = {}) {
  let now = 100000;
  const session = {
    _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['user_2', 'user_3'] }] },
    getParticipantProfile: () => null, zoneProfileStore: null, logEvent: vi.fn(),
    getActiveParticipantState: () => ({ participants: ['user_2', 'user_3'], zoneMap: { user_2: 'active', user_3: 'active' }, totalCount: 2 })
  };
  const engine = new GovernanceEngine(session, { now: () => now, random: () => 0.5 });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: governed ? ['cardio'] : [] });
  const tick = (delta = 0, entry = fresh(now + delta), zone = 'active') => {
    now += delta;
    engine.evaluate({ activeParticipants: ['user_2', 'user_3'],
      userZoneMap: { user_2: zone, user_3: zone }, totalCount: 2,
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3 },
      zoneInfoMap: { active: { id: 'active', name: 'Active' } },
      equipmentCadenceMap: entry ? { cycle_ace: entry } : {} });
    return engine.state;
  };
  if (manual) {
    expect(engine.triggerChallenge({ type: 'cycle', selectionId: 'default_0_0', riderId: 'user_2' }).success).toBe(true);
    tick();
  }
  return { engine, session, tick, now: () => now };
}
beforeEach(() => { vi.useFakeTimers(); logged.length = 0; });
afterEach(() => vi.useRealTimers());

describe('cycle cadence availability and automatic selection', () => {
  const unavailable = [
    ['missing', null], ['disconnected', { rpm: 80, connected: false, ts: 100000 }],
    ['stale', { rpm: 80, connected: true, ts: 97999 }],
    ['future', { rpm: 80, connected: true, ts: 100001 }],
    ['invalid rpm', { rpm: NaN, connected: true, ts: 100000 }],
    ['invalid timestamp', { rpm: 80, connected: true, ts: NaN }],
    ['missing timestamp', { rpm: 80, connected: true }],
    ['transport stall', { rpm: 80, connected: true, ts: 100000, transportStalled: true }]
  ];
  it.each(unavailable)('does not automatically select %s cadence', (_name, entry) => {
    const f = fixture({ manual: false });
    f.tick(0, entry);
    expect(f.engine._hasAvailableCycleCadence('cycle_ace', f.now())).toBe(false);
    expect(f.engine.challengeState.nextChallenge).toBeNull();
    f.tick(1500, entry);
    expect(f.engine.challengeState.activeChallenge).toBeNull();
  });
  it.each([0, 80])('selects connected fresh %i RPM including the 2000ms boundary', (rpm) => {
    const f = fixture({ manual: false });
    f.tick(0, fresh(f.now() - 2000, rpm));
    expect(f.engine._hasAvailableCycleCadence('cycle_ace', f.now())).toBe(true);
    expect(f.engine.challengeState.nextChallenge?.type).toBe('cycle');
    f.tick(1000, fresh(f.now() + 1000, rpm));
    expect(f.engine.challengeState.activeChallenge?.type).toBe('cycle');
  });
  it('keeps normal effort locking for repeated fresh stopped-rider packets', () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.tick(500, fresh(f.now() + 500, 0));
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('locked');
    expect(f.engine.state.videoLocked).toBe(true);
    expect(f.engine.state.challenge.sensorUnavailable).toBe(false);
  });
});

describe('active cycle sensor recovery', () => {
  it.each(['init', 'ramp', 'maintain', 'locked'])('freezes %s, releases the cycle lock, then cancels once at 10000ms without cooldown or reward', (state) => {
    const f = fixture();
    const active = f.engine.challengeState.activeChallenge;
    active.cycleState = state; active._publishedCycleState = state;
    active.lockReason = state === 'locked' ? 'init' : null;
    active.initElapsedMs = 400; active.rampElapsedMs = 500; active.phaseProgressMs = 600;
    active.cycleHealthMs = 2000;
    f.engine.challengeState.videoLocked = state === 'locked';
    const cooldowns = { ...f.engine._cycleCooldowns };
    const lost = { rpm: 0, connected: false, ts: f.now() };
    let snapshot = f.tick(200, lost).challenge;
    expect(snapshot.sensorUnavailable).toBe(true);
    expect(snapshot.sensorGraceRemainingMs).toBe(10000);
    expect(f.engine.challengeState.videoLocked).toBe(false);
    expect(f.engine.state.videoLocked).toBe(false);
    snapshot = f.tick(9999, lost).challenge;
    expect(snapshot.sensorGraceRemainingMs).toBe(1);
    expect(active).toMatchObject({ cycleState: state, initElapsedMs: 400, rampElapsedMs: 500, phaseProgressMs: 600, cycleHealthMs: 2000 });
    f.tick(1, lost);
    expect(f.engine.challengeState.activeChallenge).toBeNull();
    expect(f.engine.challengeState.challengeHistory.at(-1)).toMatchObject({ id: active.id, type: 'cycle', status: 'cancelled', cancelReason: 'sensor_offline' });
    expect(f.engine._cycleCooldowns).toEqual(cooldowns);
    expect(f.session.logEvent).toHaveBeenCalledExactlyOnceWith('challenge_cancelled', expect.objectContaining({ challengeId: active.id, type: 'cycle', reason: 'sensor_offline', equipmentId: 'cycle_ace' }), f.now());
    f.tick(500, lost);
    expect(f.session.logEvent).toHaveBeenCalledTimes(1);
    expect(logged.filter(l => l.event === 'governance.cycle.sensor_unavailable')).toHaveLength(1);
    expect(logged.filter(l => l.event === 'governance.cycle.cancelled')[0].data).toMatchObject({ challengeId: active.id, equipmentId: 'cycle_ace', unavailableMs: 10000 });
  });
  it('resumes at the same progress before the boundary without catchup', () => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; active.phaseProgressMs = 500;
    const lost = { rpm: 0, connected: false };
    f.tick(200, lost); f.tick(9000, lost);
    // CadenceFilter smoothing is unchanged; a 200 RPM sample clears the
    // 60 RPM target immediately after the filter decays during the outage.
    const snapshot = f.tick(999, fresh(f.now() + 999, 200)).challenge;
    expect(snapshot.sensorUnavailable).toBe(false);
    expect(snapshot.sensorGraceRemainingMs).toBeNull();
    expect(active.phaseProgressMs).toBe(500);
    f.tick(200, fresh(f.now() + 200, 200));
    expect(active.phaseProgressMs).toBe(700);
    expect(logged.filter(l => l.event === 'governance.cycle.sensor_recovered')[0].data).toMatchObject({ challengeId: active.id, equipmentId: 'cycle_ace', unavailableMs: 9999 });
  });
  it.each([10000, 10001])('cancels neutrally when fresh cadence returns after %i ms of loss', (elapsedMs) => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    const cooldowns = { ...f.engine._cycleCooldowns };
    f.tick(0, null); f.tick(9999, null);
    f.tick(elapsedMs - 9999, fresh(f.now() + elapsedMs - 9999));
    expect(f.engine.challengeState.activeChallenge).toBeNull();
    expect(f.engine.challengeState.challengeHistory).toEqual([
      expect.objectContaining({ id: active.id, type: 'cycle', status: 'cancelled', cancelReason: 'sensor_offline' })
    ]);
    expect(f.engine._cycleCooldowns).toEqual(cooldowns);
    expect(f.session.logEvent).toHaveBeenCalledExactlyOnceWith('challenge_cancelled', expect.objectContaining({ challengeId: active.id, type: 'cycle', reason: 'sensor_offline' }), f.now());
    expect(logged.filter(l => l.event === 'governance.cycle.sensor_recovered')).toHaveLength(0);
    expect(logged.filter(l => l.event === 'governance.cycle.cancelled')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ challengeId: active.id, unavailableMs: elapsedMs }) })
    ]);
    f.tick(0);
    expect(f.session.logEvent).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['pause', 9999], ['pause', 10000], ['transport stall', 9999], ['transport stall', 10000]
  ])('uses adjusted loss time when fresh cadence returns after a %s at %i ms', (suspension, elapsedMs) => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    f.tick(0, null); f.tick(4000, null);
    if (suspension === 'pause') {
      f.engine.setPlaybackPaused(true); f.tick(30000, null); f.engine.setPlaybackPaused(false);
    } else {
      const stalled = { rpm: 80, connected: false, ts: f.now(), transportStalled: true };
      f.tick(0, stalled); f.tick(30000, stalled); f.tick(0, null);
    }
    f.tick(elapsedMs - 4000, fresh(f.now() + elapsedMs - 4000));
    if (elapsedMs === 9999) {
      expect(f.engine.challengeState.activeChallenge).toBe(active);
      expect(active.sensorUnavailable).toBe(false);
      expect(logged.filter(l => l.event === 'governance.cycle.sensor_recovered')).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ challengeId: active.id, unavailableMs: 9999 }) })
      ]);
      expect(f.session.logEvent).not.toHaveBeenCalled();
    } else {
      expect(f.engine.challengeState.activeChallenge).toBeNull();
      expect(f.engine.challengeState.challengeHistory.at(-1)).toMatchObject({ id: active.id, status: 'cancelled', cancelReason: 'sensor_offline' });
      expect(logged.filter(l => l.event === 'governance.cycle.sensor_recovered')).toHaveLength(0);
      expect(f.session.logEvent).toHaveBeenCalledTimes(1);
    }
  });
  it('does not charge recovery time against an existing never-started effort deadline', () => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'locked'; active.lockReason = 'init'; active._initFailSince = f.now() - 14000;
    f.tick(0, null); f.tick(9000, null); f.tick(0, fresh(f.now(), 0));
    expect(active.status).toBe('pending');
    f.tick(500, fresh(f.now() + 500, 0));
    expect(active.status).toBe('pending');
  });
  it('rider swaps preserve the equipment loss window', () => {
    const f = fixture(); f.tick(0, null); f.tick(9000, null);
    expect(f.engine.swapCycleRider('user_3', { force: true }).success).toBe(true);
    expect(f.tick(999, null).challenge.sensorGraceRemainingMs).toBe(1);
    f.tick(1, null);
    expect(f.engine.challengeState.activeChallenge).toBeNull();
  });
  it('paused playback excludes its duration from recovery', () => {
    const f = fixture(); f.tick(0, null); f.tick(4000, null);
    f.engine.setPlaybackPaused(true); f.tick(30000, null);
    f.engine.setPlaybackPaused(false);
    expect(f.engine.state.challenge.sensorGraceRemainingMs).toBe(6000);
    f.tick(5999, null); expect(f.engine.challengeState.activeChallenge).not.toBeNull();
    f.tick(1, null); expect(f.engine.challengeState.activeChallenge).toBeNull();
  });
  it('transport stalls exclude their duration from equipment recovery', () => {
    const f = fixture(); f.tick(0, null); f.tick(4000, null);
    const stalled = { rpm: 80, connected: false, ts: f.now(), transportStalled: true };
    f.tick(0, stalled); f.tick(30000, stalled);
    f.tick(0, null);
    expect(f.engine.state.challenge.sensorGraceRemainingMs).toBe(6000);
    f.tick(5999, null); expect(f.engine.challengeState.activeChallenge).not.toBeNull();
    f.tick(1, null); expect(f.engine.challengeState.activeChallenge).toBeNull();
  });
  it('transport stall alone retains its existing freeze without starting sensor recovery', () => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; const before = active.phaseProgressMs;
    const stalled = { rpm: 80, connected: false, ts: f.now(), transportStalled: true };
    f.tick(200, stalled); f.tick(30000, stalled);
    expect(active.phaseProgressMs).toBe(before);
    expect(f.engine.state.challenge.sensorUnavailable).toBe(false);
  });
  it('sensor recovery releases no base-HR governance lock', () => {
    const f = fixture(); const active = f.engine.challengeState.activeChallenge;
    active.manualTrigger = false; active.cycleState = 'locked'; active.lockReason = 'init';
    f.tick(0, null, 'cool'); f.tick(2000, null, 'cool');
    expect(f.engine.state.challenge.sensorUnavailable).toBe(true);
    expect(f.engine.challengeState.videoLocked).toBe(false);
    expect(f.engine.state.videoLocked).toBe(true);
  });
  it('caps neutral cancellation history at 20 entries', () => {
    const f = fixture();
    f.engine.challengeState.challengeHistory = Array.from({ length: 20 }, (_, id) => ({ id }));
    f.tick(0, null); f.tick(10000, null);
    expect(f.engine.challengeState.challengeHistory).toHaveLength(20);
    expect(f.engine.challengeState.challengeHistory[0].id).toBe(1);
    expect(f.engine.challengeState.challengeHistory.at(-1).status).toBe('cancelled');
  });
  it('manual cycles on ungoverned media also cancel neutrally', () => {
    const f = fixture({ governed: false });
    f.tick(0, null); f.tick(10000, null);
    expect(f.engine.challengeState.activeChallenge).toBeNull();
    expect(f.engine.challengeState.challengeHistory).toHaveLength(1);
    expect(f.engine.challengeState.challengeHistory.at(-1).status).toBe('cancelled');
    expect(f.session.logEvent).toHaveBeenCalledTimes(1);
  });
});
