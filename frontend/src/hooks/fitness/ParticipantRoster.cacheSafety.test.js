/**
 * Roster-cache SAFETY guards (Stage 1 of the 2026-07-17 fitness re-architecture).
 *
 * The roster cache must never trade correctness for speed. These pin the four
 * landmines identified in review:
 *   1. getFullRoster() must not poison the shared cached array (it pushes ghost
 *      entries) — the cache is frozen in dev/test and getFullRoster copies.
 *   2. A removed device must yield an EMPTY roster on the next read, not a
 *      stale-active one — this is what lets _checkEmptyRosterTimeout end the
 *      session (a stale-active cache = zombie sessions with no endTime).
 *   3. _historicalParticipants side effects survive cache hits.
 *   4. The TTL backstop forces a rebuild even with no version change.
 */
import { describe, it, expect, vi } from 'vitest';

import { FitnessSession } from './FitnessSession.js';
import { ROSTER_CACHE_TTL_MS } from './ParticipantRoster.js';

const STARTUP_DISCARD_COUNT = 3;

function hrPacket(deviceId, bpm) {
  return { topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: bpm } };
}

function makeStartedSession() {
  const session = new FitnessSession();
  session.userManager.registerUser({ id: 'user-a', name: 'Rider A', hr_device_id: 'hr-a' });
  session.ensureStarted({ force: true, reason: 'cacheSafety-test' });
  return session;
}

function warmDevice(session, deviceId, bpm) {
  for (let i = 0; i < STARTUP_DISCARD_COUNT + 3; i += 1) session.ingestData(hrPacket(deviceId, bpm));
}

describe('ParticipantRoster cache safety', () => {
  it('does not let getFullRoster() poison the shared cached roster array', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    const cached = session.roster;                 // shared cached array
    const lenBefore = cached.length;

    const full1 = session._participantRoster.getFullRoster();
    const full2 = session._participantRoster.getFullRoster();

    expect(full1).not.toBe(cached);                // must be a copy, not the cache
    expect(session.roster.length).toBe(lenBefore); // cache length unchanged
    expect(full2.length).toBe(full1.length);       // repeated calls are stable (no accumulation)
  });

  it('returns an EMPTY roster after the device is removed (no stale-active cache)', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    expect(session.roster).toHaveLength(1);        // builds + caches 1 active rider

    session.deviceManager.removeDevice('hr-a');    // strap gone → mutationVersion bumps

    expect(session.roster).toHaveLength(0);        // must NOT serve the stale 1-rider cache
  });

  it('ends the session via empty-roster timeout after all devices are pruned', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);
    expect(session.roster).toHaveLength(1);

    session.deviceManager.removeDevice('hr-a');    // roster now empty (fresh, not cached)

    const endSpy = vi.spyOn(session, 'endSession');
    // First check arms the empty-roster timer; a second check after the window
    // must end the session. Simulate elapsed time by back-dating the start mark.
    session._checkEmptyRosterTimeout();
    expect(session._emptyRosterStartTime).not.toBeNull();
    session._emptyRosterStartTime -= 10 * 60 * 1000; // 10 min ago — well past window
    session._checkEmptyRosterTimeout();

    expect(endSpy).toHaveBeenCalledWith('empty_roster');
  });

  it('preserves historical participants across cache hits', () => {
    const session = makeStartedSession();
    warmDevice(session, 'hr-a', 120);

    session.roster; session.roster; session.roster; // repeated cached reads
    const historical = session._participantRoster.getHistoricalParticipants();

    expect(historical).toContain('user-a');
  });

  it('rebuilds after the TTL backstop expires with no version change', () => {
    vi.useFakeTimers();
    try {
      const session = makeStartedSession();
      warmDevice(session, 'hr-a', 120);
      session.roster; // build + cache

      const buildSpy = vi.spyOn(session._participantRoster, '_buildRoster');
      session.roster; // still fresh → cache hit, no build
      expect(buildSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(ROSTER_CACHE_TTL_MS + 100); // TTL expires, no data change
      session.roster;
      expect(buildSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
