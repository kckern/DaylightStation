/**
 * Roster-cache regression (fitness perf fix, 2026-07-17 disaster follow-up).
 *
 * Bug we are guarding: FitnessSession.get roster() → ParticipantRoster.getRoster()
 * had NO working cache (the _cachedRoster/_cacheVersion fields existed but were
 * never read). During a workout ~4 React context consumers each read `.roster`
 * on every context re-render, plus a governance pulse path, so for a SINGLE
 * rider the roster rebuilt ~34x/second. That main-thread storm starved the
 * Firefox tab (silent mid-workout crash) and froze the exit.
 *
 * Fix: cache the built roster and rebuild ONLY when device/HR/zone/assignment
 * state actually changes. These tests pin BOTH halves of the contract:
 *   1. repeated reads with no data change reuse the cache (one build), and
 *   2. a data change (new device, changed HR) still produces a fresh roster —
 *      i.e. the cache must never serve stale participant state.
 */
import { describe, it, expect, vi } from 'vitest';

import { FitnessSession } from './FitnessSession.js';

// First 3 HR packets per device are discarded as stale-on-connect.
const STARTUP_DISCARD_COUNT = 3;

function hrPacket(deviceId, bpm) {
  return {
    topic: 'fitness',
    type: 'ant',
    deviceId,
    profile: 'HR',
    data: { ComputedHeartRate: bpm },
  };
}

function makeStartedSession() {
  const session = new FitnessSession();
  session.userManager.registerUser({ id: 'user-a', name: 'Rider A', hr_device_id: 'hr-a' });
  session.userManager.registerUser({ id: 'user-b', name: 'Rider B', hr_device_id: 'hr-b' });
  session.ensureStarted({ force: true, reason: 'rosterCache-test' });
  return session;
}

/** Ingest enough packets that the device clears the startup-discard window. */
function warmDevice(session, deviceId, bpm) {
  for (let i = 0; i < STARTUP_DISCARD_COUNT + 3; i += 1) {
    session.ingestData(hrPacket(deviceId, bpm));
  }
}

describe('FitnessSession — roster is cached across reads but never stale', () => {
  it('rebuilds the roster only once across many reads with no data change', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    // _buildZoneLookup runs exactly once per real getRoster build, so it is a
    // faithful proxy for "the roster was actually rebuilt".
    const buildSpy = vi.spyOn(session._participantRoster, '_buildZoneLookup');

    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-unused-expressions
      session.roster;
    }

    // 6 reads, zero intervening data changes → at most ONE rebuild.
    expect(buildSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('reflects a newly-connected rider (does not serve a stale 1-rider roster)', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    const before = session.roster;           // builds + caches (1 rider)
    expect(before.map((e) => e.id)).toContain('user-a');
    expect(before).toHaveLength(1);

    warmDevice(session, 'hr-b', 130);        // second rider connects

    const after = session.roster;            // must NOT be the stale cached array
    expect(after).toHaveLength(2);
    expect(after.map((e) => e.id).sort()).toEqual(['user-a', 'user-b']);
  });

  it('reflects a changed heart rate (does not serve a stale HR)', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    const firstHr = session.roster[0].heartRate;   // builds + caches
    expect(firstHr).toBeGreaterThan(0);

    // Drive the HR clearly upward with several plausible steps.
    for (const bpm of [128, 136, 144, 150, 150, 150]) {
      session.ingestData(hrPacket('hr-a', bpm));
    }

    const laterHr = session.roster[0].heartRate;
    expect(laterHr).toBeGreaterThan(firstHr);
  });
});
