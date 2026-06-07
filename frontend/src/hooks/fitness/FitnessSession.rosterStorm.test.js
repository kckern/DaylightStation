/**
 * Roster-rebuild storm regression (Task 2 of the fitness perf fix).
 *
 * Bug we are guarding: the per-HR-packet zone-profile sync used to call the
 * expensive ParticipantRoster.getRoster() on EVERY heart-rate packet, only to
 * extract the set of present participant IDs. At ~55 packets/sec that meant
 * ~55 full roster rebuilds per second (zone lookups, label resolution,
 * per-entry logging) just to filter `getAllUsers()`.
 *
 * Fix: use the cheap ParticipantRoster.getPresentParticipantIds() (added in
 * Task 1) which returns the present IDs without building full entries.
 *
 * This test ingests heart-rate packets for a mapped device and asserts that
 * the ingest path:
 *   - calls getPresentParticipantIds() (the cheap query), and
 *   - does NOT call getRoster() (the expensive rebuild), and
 *   - still performs zone-profile sync with the present user.
 */
import { describe, it, expect, vi } from 'vitest';

import { FitnessSession } from './FitnessSession.js';

// First 3 HR packets per device are discarded as stale-on-connect, so the
// zone-sync block (Site A) only runs from the 4th packet onward.
const STARTUP_DISCARD_COUNT = 3;

/** Build an ANT+ heart-rate ingest payload for a given device id. */
function hrPacket(deviceId, bpm) {
  return {
    topic: 'fitness',
    type: 'ant',
    deviceId,
    profile: 'HR',
    data: { ComputedHeartRate: bpm },
  };
}

describe('FitnessSession — per-packet zone sync avoids roster-rebuild storm', () => {
  it('uses getPresentParticipantIds (not getRoster) on the HR ingest path while still syncing zones', () => {
    const session = new FitnessSession();

    // Map a heart-rate device to a registered (non-PII) user so the device
    // resolves to a real participant and getPresentParticipantIds returns it.
    const deviceId = 'hr-test-1';
    const userId = 'test-user-1';
    session.userManager.registerUser({
      id: userId,
      name: 'Test One',
      hr_device_id: deviceId,
    });

    // start() wires deviceManager/userManager into the ParticipantRoster, which
    // getPresentParticipantIds() requires.
    session.ensureStarted({ force: true, reason: 'rosterStorm-test' });

    // Spy AFTER setup so unrelated start-up roster reads don't pollute counts.
    const getRosterSpy = vi.spyOn(session._participantRoster, 'getRoster');
    const getPresentSpy = vi.spyOn(session._participantRoster, 'getPresentParticipantIds');
    const syncZonesSpy = vi.spyOn(session, '_syncZoneProfiles');

    // Ingest enough packets to clear the startup-discard window and exercise
    // the zone-sync block several times.
    const TOTAL_PACKETS = STARTUP_DISCARD_COUNT + 4; // 3 discarded + 4 real
    const realPackets = TOTAL_PACKETS - STARTUP_DISCARD_COUNT;
    for (let i = 0; i < TOTAL_PACKETS; i += 1) {
      session.ingestData(hrPacket(deviceId, 120 + i));
    }

    // The cheap presence query must be used on each non-discarded packet.
    expect(getPresentSpy.mock.calls.length).toBeGreaterThanOrEqual(realPackets);

    // The expensive rebuild must NOT be triggered by the ingest path.
    expect(getRosterSpy).not.toHaveBeenCalled();

    // Zone-profile sync must still occur with the present user.
    expect(syncZonesSpy.mock.calls.length).toBeGreaterThanOrEqual(realPackets);
    const lastSyncArg = syncZonesSpy.mock.calls.at(-1)?.[0];
    expect(Array.isArray(lastSyncArg)).toBe(true);
    expect(lastSyncArg.map((u) => u.id)).toContain(userId);
  });
});
