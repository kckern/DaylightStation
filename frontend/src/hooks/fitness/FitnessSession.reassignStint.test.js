/**
 * A strap reassignment inside the usage window is a CORRECTION ("that was
 * actually X"): the strap's open stint — HR, zones, rings, beats, activity —
 * moves to the picked person and the stint is relabelled in place. Outside the
 * window it is a HANDOVER: nothing moves, the stint closes, a new one opens.
 *
 * Motivating session 2026-09-23: rings split between two children because the
 * old transfer moved the timeline but not the ring/beat counters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';
import { GuestAssignmentService } from './GuestAssignmentService.js';

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', rings: 2 },
];
const USERS = {
  primary: [
    { id: 'kid-a', name: 'Kid A', hr_device_id: 'D2' },
    { id: 'kid-d', name: 'Kid D', hr_device_id: 'D1' },
    { id: 'kid-e', name: 'Kid E', hr_device_id: 'D3' },
  ],
  friends: [{ id: 'kid-b', name: 'Kid B' }, { id: 'guest-c', name: 'Guest C' }],
};
const hr = (deviceId, bpm) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR',
  data: { ComputedHeartRate: bpm, timestamp: Date.now() },
});

function build({ start = true } = {}) {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger();
  session.userManager.setAssignmentLedger(ledger);
  session.userManager.configure(USERS, ZONES);
  if (start) {
    session.ensureStarted({ force: true, reason: 'reassign-test' });
    session.zoneProfileStore.setBaseZoneConfig(ZONES);
    session.treasureBox.configure({ zones: ZONES });
  }
  const svc = new GuestAssignmentService({ session, ledger, thresholdMs: 300_000 });
  return { session, svc, ledger };
}

// Advance `ticks` timeline ticks (5s each); every listed strap sends 1 packet/s.
function run(session, ticks, readings) {
  for (let s = 0; s < ticks * 5; s += 1) {
    vi.advanceTimersByTime(1000);
    for (const [dev, bpm] of Object.entries(readings)) session.ingestData(hr(dev, bpm));
  }
}
const series = (session, id, metric) => session.timeline.series[`user:${id}:${metric}`] || [];
const isNonDecreasing = (arr) => {
  let max = null;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    if (max != null && v < max) return false;
    max = v;
  }
  return true;
};
const totalRings = (session) => [...session.treasureBox.perUser.values()]
  .reduce((sum, acc) => sum + (acc.totalRings || 0), 0);

describe('FitnessSession.reassignStint', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_790_213_728_000); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('correction into a person who already has rings moves only the stint and conserves rings', () => {
    const { session, svc } = build();
    // kid-a (warm, 2/interval) out-earns kid-d (active, 1/interval), so a
    // transfer that copies totals instead of deltas shows up as a drop.
    run(session, 12, { D2: 140, D1: 110 });
    expect(session.treasureBox.perUser.get('kid-a')?.totalRings).toBeGreaterThan(0);
    const before = totalRings(session);
    svc.assignGuest('D2', { name: 'Kid D', profileId: 'kid-d', allowWhileAssigned: true });
    expect(totalRings(session)).toBe(before);
    run(session, 6, { D2: 140, D1: 110 });
    expect(isNonDecreasing(series(session, 'kid-d', 'rings_total'))).toBe(true);
    expect(isNonDecreasing(series(session, 'kid-a', 'rings_total'))).toBe(true);
    session.reset();
  });

  it('handover moves nothing and closes the stint', () => {
    const { session, svc } = build();
    run(session, 4, { D2: 140 });
    vi.advanceTimersByTime(301_000);
    run(session, 2, { D2: 140 });
    const aRings = session.treasureBox.perUser.get('kid-a').totalRings;
    svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' });
    expect(session.treasureBox.perUser.get('kid-a').totalRings).toBe(aRings);
    const stints = session.entityRegistry.getAll().filter((e) => e.deviceId === 'D2');
    expect(stints.map((e) => [e.profileId, e.status, e.endReason])).toEqual([
      ['kid-a', 'superseded', 'handover'],
      ['kid-b', 'active', null],
    ]);
    session.reset();
  });

  it('replays the motivating chain: D1 kid-d→guest-c, D2 kid-a→kid-b→kid-a, D3 kid-e→kid-b', () => {
    const { session, svc } = build();
    run(session, 3, { D1: 95 });
    svc.assignGuest('D1', { name: 'Guest C', profileId: 'guest-c' });
    run(session, 3, { D1: 150, D2: 150 });
    svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' });
    run(session, 48, { D1: 150, D2: 150 });
    const ringsOnD2 = session.treasureBox.perUser.get('kid-b').totalRings;
    expect(ringsOnD2).toBeGreaterThan(0);
    run(session, 1, { D1: 150, D2: 150, D3: 120 });
    svc.assignGuest('D2', { name: 'Kid A', profileId: 'kid-a' });
    svc.assignGuest('D3', { name: 'Kid B', profileId: 'kid-b' });
    run(session, 20, { D1: 150, D2: 150, D3: 120 });

    for (const id of ['kid-a', 'kid-b', 'guest-c', 'kid-d', 'kid-e']) {
      expect(isNonDecreasing(series(session, id, 'rings_total')), `${id} rings`).toBe(true);
      expect(isNonDecreasing(series(session, id, 'heart_beats')), `${id} beats`).toBe(true);
    }
    // kid-a got the whole D2 stint; kid-b kept none of it.
    expect(session.treasureBox.perUser.get('kid-a').totalRings).toBeGreaterThanOrEqual(ringsOnD2);
    expect(session.treasureBox.perUser.get('kid-b').totalRings).toBeLessThan(ringsOnD2);
    const active = session.entityRegistry.getAll().filter((e) => e.status === 'active');
    const byDevice = Object.fromEntries(active.map((e) => [e.deviceId, e]));
    expect(byDevice.D2.profileId).toBe('kid-a');
    expect(byDevice.D2.relabeledFrom).toEqual(['kid-a', 'kid-b']);
    expect(byDevice.D1.relabeledFrom).toEqual(['kid-d']);
    expect(byDevice.D3.relabeledFrom).toEqual(['kid-e']);
    session.reset();
  });

  it('pre-session correction is a no-op on data and opens a stint at start', () => {
    const { session, svc, ledger } = build({ start: false });
    expect(() => svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' })).not.toThrow();
    session.ensureStarted({ force: true, reason: 'test' });
    const stint = session.entityRegistry.getByDevice('D2');
    expect(stint).toMatchObject({ profileId: 'kid-b', startTick: 0 });
    expect(ledger.get('D2').entityId).toBe(stint.entityId);
    session.reset();
  });

  it('auto-assigned member gets a stint', () => {
    const { session } = build();
    run(session, 5, { D2: 120 });
    expect(session.entityRegistry.getByDevice('D2')?.profileId).toBe('kid-a');
    session.reset();
  });

  it('removed transfer paths are gone', () => {
    expect(FitnessSession.prototype.transferUserSeries).toBeUndefined();
    expect(FitnessSession.prototype.transferSessionEntity).toBeUndefined();
  });
});
