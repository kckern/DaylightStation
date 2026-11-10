/**
 * 2026-09-01: rings accrued for a learner whose roster tile, zone series and
 * garage LED all still said "cool". TreasureBox scored him on the GLOBAL zone
 * table (active=100) while everything on screen used his personal one
 * (active=120).
 *
 * The cause was ordering inside FitnessSession.recordDeviceActivity, not a
 * one-off race: the TreasureBox feed and the ZoneProfileStore sync are gated by
 * the same startup-discard counter, so both open on the same packet — and the
 * box ran first. Its first read therefore found no profile and fell back to
 * global thresholds. These tests pin the fixed order end-to-end, from user
 * config through to the accumulator the ring is scored from.
 */
import { describe, it, expect, vi } from 'vitest';

import { FitnessSession } from "./FitnessSession.js";

// FitnessSession.recordDeviceActivity — first N HR packets per device are dropped.
const STARTUP_DISCARD_COUNT = 3;

// Hand-written to pin the HISTORICAL incident (global active=100 vs user_4's
// personal 120), not the current data/household/fitness/config.yml.
const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', rings: 3 },
];
const PERSONAL_ZONE_OVERRIDES = { active: 120, warm: 140, hot: 160 };
// Between the two `active` thresholds: the two tables disagree about whether
// this sample earns a ring, which is the whole point of the fixture.
const BETWEEN_BPM = 105;

const minOf = (zones, id) => zones.find((z) => z.id === id)?.min;

function hrPacket(deviceId, bpm) {
  return {
    topic: 'fitness',
    type: 'ant',
    deviceId,
    profile: 'HR',
    data: { ComputedHeartRate: bpm },
  };
}

function startedSession(users = [{ id: 'user_4', name: 'User_4', hr_device_id: 'hr-user_4', zones: PERSONAL_ZONE_OVERRIDES }]) {
  const session = new FitnessSession();
  session.userManager.configure(
    { primary: users },
    GLOBAL_ZONES
  );
  session.ensureStarted({ force: true, reason: 'zoneSyncOrder-test' });
  expect(session.treasureBox).toBeTruthy();
  // Mirrors the zoneConfig injection in _collectTimelineTick.
  session.zoneProfileStore.setBaseZoneConfig(GLOBAL_ZONES);
  session.treasureBox.configure({ zones: GLOBAL_ZONES });
  return session;
}

describe('FitnessSession — the zone store is synced before TreasureBox scores a packet', () => {
  it('scores the first non-discarded sample on the personal thresholds, not the global ones', () => {
    const session = startedSession();

    // Scenario fidelity: the rider really does carry personal thresholds.
    const user_4 = session.userManager.getAllUsers().find((u) => u.id === 'user_4');
    expect(minOf(user_4.zoneConfig, 'active')).toBe(120);

    for (let i = 0; i < STARTUP_DISCARD_COUNT; i += 1) {
      session.ingestData(hrPacket('hr-user_4', BETWEEN_BPM));
    }
    expect(session.treasureBox.perUser.has('user_4')).toBe(false); // nothing scored during the discard window

    session.ingestData(hrPacket('hr-user_4', BETWEEN_BPM)); // the first sample that counts

    const acc = session.treasureBox.perUser.get('user_4');
    expect(acc).toBeTruthy();
    // 105 is under user_4's active=120 → cool, worth no rings.
    // Before the reorder this was 'active' (global 100) and paid a ring.
    expect(acc.highestZone.id).toBe('cool');
  });

  it('logs no zone_override_miss on a healthy session', () => {
    const session = startedSession();
    const logSpy = vi.spyOn(session.treasureBox, '_log');

    for (let i = 0; i < STARTUP_DISCARD_COUNT + 3; i += 1) {
      session.ingestData(hrPacket('hr-user_4', BETWEEN_BPM));
    }

    // The warn exists to surface a rider the store never learns about. If a
    // healthy session emits it too, it is noise and the next incident hides in it.
    expect(logSpy.mock.calls.filter(([event]) => event === 'zone_override_miss')).toEqual([]);
  });
  // A per-user accepted flag from the incoming strap must not authorize a
  // different strap's discarded reading selected by lowest-HR arbitration.
  it('does not let accepted high strap A authorize discarded Cool from strap B', () => {
    const session = startedSession([{ id: 'rider-a', name: 'Rider A', hr_device_ids: ['strap-a', 'strap-b'] }]);
    for (let i = 0; i < 4; i++) session.ingestData(hrPacket('strap-a', 187));
    expect(session.getZoneProfile('rider-a').zoneTrusted).toBe(false);
    session.ingestData(hrPacket('strap-b', 90)); // B's first reading is discarded
    session.ingestData(hrPacket('strap-a', 187)); // accepted A; canonical HR still comes from B
    expect(session.getZoneProfile('rider-a')).toMatchObject({ heartRate: 90, zoneTrusted: false, currentZoneId: null });
    expect(session.treasureBox.perUser.get('rider-a')?.highestZone ?? null).toBeNull();
    expect(session.treasureBox.perUser.get('rider-a')?.totalRings ?? 0).toBe(0);
    session.reset();
  });

  it('scores the accepted canonical low reading when another strap reports high', () => {
    const session = startedSession([{ id: 'rider-a', name: 'Rider A', hr_device_ids: ['strap-a', 'strap-b'] }]);
    for (let i = 0; i < 4; i++) session.ingestData(hrPacket('strap-a', 187));
    for (let i = 0; i < 4; i++) session.ingestData(hrPacket('strap-b', 90));
    expect(session.getZoneProfile('rider-a')).toMatchObject({ heartRate: 90, zoneTrusted: true, currentZoneId: 'cool' });
    session.ingestData(hrPacket('strap-a', 187));
    expect(session.treasureBox.perUser.get('rider-a').highestZone.id).toBe('cool');
    expect(session.treasureBox.perUser.get('rider-a').lastHR).toBe(90);
    session.reset();
  });

});
