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

import { FitnessSession } from './FitnessSession.js';

// FitnessSession.recordDeviceActivity — first N HR packets per device are dropped.
const STARTUP_DISCARD_COUNT = 3;

// Hand-written to pin the HISTORICAL incident (global active=100 vs learner-a's
// personal 120), not the current data/household/fitness/config.yml.
const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', rings: 3 },
];
const MILO_ZONE_OVERRIDES = { active: 120, warm: 140, hot: 160 };
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

function startedSession() {
  const session = new FitnessSession();
  session.userManager.configure(
    { primary: [{ id: 'learner-a', name: 'Learner A', hr_device_id: 'hr-learner-a', zones: MILO_ZONE_OVERRIDES }] },
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
    const learnerA = session.userManager.getAllUsers().find((u) => u.id === 'learner-a');
    expect(minOf(learnerA.zoneConfig, 'active')).toBe(120);

    for (let i = 0; i < STARTUP_DISCARD_COUNT; i += 1) {
      session.ingestData(hrPacket('hr-learner-a', BETWEEN_BPM));
    }
    expect(session.treasureBox.perUser.has('learner-a')).toBe(false); // nothing scored during the discard window

    session.ingestData(hrPacket('hr-learner-a', BETWEEN_BPM)); // the first sample that counts

    const acc = session.treasureBox.perUser.get('learner-a');
    expect(acc).toBeTruthy();
    // 105 is under learner-a's active=120 → cool, worth no rings.
    // Before the reorder this was 'active' (global 100) and paid a ring.
    expect(acc.highestZone.id).toBe('cool');
  });

  it('logs no zone_override_miss on a healthy session', () => {
    const session = startedSession();
    const logSpy = vi.spyOn(session.treasureBox, '_log');

    for (let i = 0; i < STARTUP_DISCARD_COUNT + 3; i += 1) {
      session.ingestData(hrPacket('hr-learner-a', BETWEEN_BPM));
    }

    // The warn exists to surface a rider the store never learns about. If a
    // healthy session emits it too, it is noise and the next incident hides in it.
    expect(logSpy.mock.calls.filter(([event]) => event === 'zone_override_miss')).toEqual([]);
  });
});
