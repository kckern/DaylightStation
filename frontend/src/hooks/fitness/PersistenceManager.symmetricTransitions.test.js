/**
 * W1.C / OI-3 → EFFORT-REPLACES-DURATION update.
 *
 * ORIGINAL intent (duration model): the continuous-usage threshold absorbs
 * sub-T segments forward regardless of WHO occupies the segment. Under the
 * old model the 30s test-user-a segment (sub-threshold by duration) was
 * absorbed forward into test-user-b, leaving only test-user-b.
 *
 * NEW intent (effort model — Task 10): effort REPLACES duration as the absorb
 * gate on the series path. `runSessionBackfill` no longer calls
 * `applyAbsorbRules`; only `applyEffortAbsorb` folds segments, and only when
 * effort is INSIGNIFICANT (near-zero coins / active-zone / HR samples). The
 * 30s test-user-a segment carries 6 real HR samples (> the 3-sample
 * significance floor) → it is a "brief-but-REAL burst" and is now KEPT, not
 * absorbed. This is the deliberate improvement the task calls out: a short but
 * genuine effort segment must not lose its identity to its neighbor. It also
 * matches the backend SessionIdentityHealer (effort-only).
 *
 * The occupant-agnostic invariant still holds: `runSessionBackfill` makes no
 * `isGuest` / `isPrimary` distinction. This test now guards that a
 * brief-but-real Mapped→Mapped segment is KEPT (was: absorbed).
 *
 * Scenario (Mapped → Mapped, no guest involved):
 *   - Device 99999 starts mapped to test-user-a.
 *   - 30 seconds of HR data (6 samples) is recorded on test-user-a.
 *   - Device is reassigned to test-user-b (a fellow household member).
 *   - 10 minutes of HR data is recorded on test-user-b.
 *
 * Expectation (effort model): BOTH test-user-a and test-user-b survive.
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

  it('KEEPS a brief-but-real Mapped→Mapped segment (effort replaces duration)', async () => {
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

    // Effort model (Task 10): test-user-a's 30s segment carries 6 real HR
    // samples (> the 3-sample significance floor) → brief-but-REAL → KEPT.
    // BOTH occupants survive; neither is absorbed.
    const participantIds = Object.keys(capturedPayload.participants || {});
    expect(participantIds).toContain('test-user-b');
    expect(participantIds).toContain('test-user-a');

    // No absorb happens: test-user-a must NOT be removed. Because there is no
    // transfer/merge/removal, the persist_backfill_applied event does not fire
    // at all — but if it ever did, test-user-a must not appear in
    // removedOccupants and there must be no test-user-a → test-user-b transfer.
    const backfillEvent = logEvents.find(e => e.eventName === 'persist_backfill_applied');
    const removed = backfillEvent?.data?.removedOccupants || [];
    expect(removed).not.toContain('test-user-a');
    const transfers = backfillEvent?.data?.transfers || [];
    expect(transfers.some(
      t => t.fromOccupantId === 'test-user-a' && t.toOccupantId === 'test-user-b'
    )).toBe(false);
  });
});
