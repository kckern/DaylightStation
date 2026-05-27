/**
 * W1.C / OI-3 — symmetric application of the backfill rule across all
 * transition types.
 *
 * The OI-3 directive states that the continuous-usage threshold absorbs
 * sub-T segments forward regardless of WHO occupies the segment — guest,
 * primary household member, family, friend. The W1.B backfill pass is
 * implemented occupant-agnostically (`runSessionBackfill` makes no
 * `isGuest` / `isPrimary` distinction; it only looks at segment durations
 * and successors). This test guards that invariant.
 *
 * Scenario (Mapped → Mapped, no guest involved):
 *   - Device 99999 starts mapped to test-user-a.
 *   - 30 seconds of HR data is recorded on test-user-a.
 *   - Device is reassigned to test-user-b (a fellow household member —
 *     the kind of swap a user-to-user hand-off would produce).
 *   - 10 minutes of HR data is recorded on test-user-b.
 *
 * Per OI-3, the 30s test-user-a segment is sub-threshold (T = 5 min) and
 * MUST be absorbed forward into test-user-b. If a regression introduced an
 * "only for guest occupants" gate (e.g. `if (previousOccupant.isGuest)` or
 * `if (previousProfileId.startsWith('#'))`), this test fails.
 *
 * Driver shape mirrors `PersistenceManager.lateTagMerge.test.js` and
 * `PersistenceManager.cyclingDetection.test.js` — crafted `sessionData`
 * payload fed to PersistenceManager directly. Keeps the test focused on
 * the backfill rule rather than the full session machinery (FitnessSession
 * does not expose a `{ now }` override on `assignGuestToDevice`).
 *
 * No PII: uses generic test identifiers per
 * `feedback_no_pii_in_test_fixtures.md`. The scenario is morally equivalent
 * to any "household member A hands the strap to household member B" case;
 * we deliberately avoid embedding real first names in test fixtures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../lib/clientId.js', () => ({
  getClientId: () => 'test-client'
}));

const { PersistenceManager } = await import('./PersistenceManager.js');

describe('PersistenceManager — symmetric threshold application (W1.C / OI-3)', () => {
  let pm;
  let capturedPayload;
  let apiCallCount;
  let logEvents;

  beforeEach(() => {
    capturedPayload = null;
    apiCallCount = 0;
    logEvents = [];
    pm = new PersistenceManager({
      persistApi: vi.fn().mockImplementation(async (url, body) => {
        if (url === 'api/v1/fitness/save_session') {
          capturedPayload = body?.sessionData;
          apiCallCount++;
        }
        return { ok: true };
      }),
      onLog: (eventName, data) => { logEvents.push({ eventName, data }); }
    });
    pm.setUsageThresholdMs(5 * 60 * 1000); // 5 minutes
  });

  it('absorbs a sub-T Mapped→Mapped segment forward (no guest involved)', async () => {
    // Layout (T = 5 min):
    //   t0         .. t0+30s    test-user-a on device 99999, 6 HR ticks
    //   t0+30s     .. t0+10m30s test-user-b on device 99999, 120 HR ticks
    // Both occupants are configured household members (no `#` prefix, no
    // `isGuest` flag) — the scenario the OI-3 directive specifically calls
    // out as a regression risk.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000;
    const subThresholdSegmentMs = 30 * 1000;
    const sessionStart = t0;
    const aEnd = t0 + subThresholdSegmentMs;
    const sessionEnd = aEnd + 10 * 60 * 1000;

    // 5s tick interval → 126 ticks across the full 10m30s session.
    //   ticks 0..5    = test-user-a data (6 ticks × 5s = 30s)
    //   ticks 6..125  = test-user-b data (120 ticks × 5s = 10m)
    const series = {
      'user:test-user-a:heart_rate': [
        ...Array(6).fill(130),
        ...Array(120).fill(null)
      ],
      'user:test-user-b:heart_rate': [
        ...Array(6).fill(null),
        ...Array(120).fill(135)
      ]
    };

    const sessionData = {
      sessionId: 'fs_20260526000010',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        // Both flagged as configured household members. NO `isGuest: true`
        // anywhere — this is a Mapped→Mapped swap.
        { profileId: 'test-user-a', name: 'Test User A', hrDeviceId: '99999' },
        { profileId: 'test-user-b', name: 'Test User B', hrDeviceId: '99999' }
      ],
      deviceAssignments: [
        // Live ledger reflects the final assignment.
        { deviceId: '99999', occupantId: 'test-user-b', occupantName: 'Test User B' }
      ],
      entities: [
        {
          entityId: 'entity-test-user-a-1',
          profileId: 'test-user-a',
          name: 'Test User A',
          deviceId: '99999',
          startTime: sessionStart,
          endTime: aEnd,
          // status:'dropped' simulates the GUEST_REPLACED in-session path
          // — if this had been status:'transferred' the backfill pass
          // would short-circuit. The test specifically exercises the case
          // where in-session logic did NOT transfer (e.g. the threshold
          // change rendered the 30s segment sub-T but in-session was
          // still on the old 60s default, or the segment endpoint
          // happened to flip status to dropped via a different path).
          status: 'dropped',
          coins: 0
        },
        {
          entityId: 'entity-test-user-b-1',
          profileId: 'test-user-b',
          name: 'Test User B',
          deviceId: '99999',
          startTime: aEnd,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: { startTime: sessionStart, intervalMs: 5000, tickCount: 126 },
        series,
        events: []
      },
      thresholdMs: T
    };

    const accepted = pm.persistSession(sessionData, { force: true });
    expect(accepted).toBe(true);

    // Drain microtasks so the persistApi Promise chain resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCallCount).toBe(1);
    expect(capturedPayload).toBeTruthy();

    // Symmetric OI-3 behavior: test-user-a's 30s segment is sub-T and is
    // absorbed forward into test-user-b. Only test-user-b survives.
    const participantIds = Object.keys(capturedPayload.participants || {});
    expect(participantIds).toContain('test-user-b');
    expect(participantIds).not.toContain('test-user-a');

    // The backfill_applied event should record exactly one transfer
    // (test-user-a → test-user-b). If a regression added a guest gate,
    // this transfer would be absent and the test-user-a participant
    // would survive.
    const backfillEvent = logEvents.find(e => e.eventName === 'persist_backfill_applied');
    expect(backfillEvent).toBeTruthy();
    const transfers = backfillEvent.data?.transfers || [];
    const aToBTransfer = transfers.find(
      t => t.fromOccupantId === 'test-user-a' && t.toOccupantId === 'test-user-b'
    );
    expect(aToBTransfer).toBeTruthy();
    // The transfer must be recorded with `removedOccupants` including the
    // sub-T occupant, confirming the backfill pass removed them rather than
    // leaving them as a stale participant.
    const removed = backfillEvent.data?.removedOccupants || [];
    expect(removed).toContain('test-user-a');
  });
});
