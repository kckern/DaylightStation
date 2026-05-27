/**
 * W1.B / Decision §5 — late-tag Pikachu merge at session save time.
 *
 * Scenario: a synthetic untagged "Pikachu" occupant accrues HR data on a
 * device, then a real configured user (test-friend) is tagged onto the same
 * device AFTER the configured continuous-usage threshold has elapsed. The
 * in-session GuestAssignmentService grace-period flow does NOT merge because
 * the Pikachu segment exceeded the threshold; per Decision §5, late tagging
 * means "I'm telling you now who this was" → merge regardless of duration.
 *
 * The save-time backfill pass owns this rule. After persist:
 *   - Saved participants contain ONLY test-friend (no Pikachu).
 *   - The Pikachu user series is emptied; test-friend's series carries the
 *     merged HR data.
 *
 * Drives PersistenceManager directly with a crafted `sessionData` payload
 * shaped exactly like FitnessSession.summary would produce — keeps the test
 * focused on the backfill rule rather than the full session machinery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../lib/clientId.js', () => ({
  getClientId: () => 'test-client'
}));

const { PersistenceManager } = await import('./PersistenceManager.js');

describe('PersistenceManager — late-tag Pikachu merge (W1.B / Decision §5)', () => {
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

  it('merges a 10-min Pikachu segment into a 5-min test-friend segment when test-friend is tagged late', async () => {
    // Build a sessionData that mirrors the FitnessSession.summary shape after
    // the scenario described in the task spec:
    //   t0    .. t0+10m   Pikachu '#90006' on device 90006, 120 HR readings
    //   t0+10m .. t0+15m  test-friend tagged onto same device, 60 HR readings
    // The Pikachu segment is 10 minutes — well past the 5-min threshold —
    // so the in-session GuestAssignmentService logged GUEST_REPLACED, not
    // SEGMENT_ABSORBED. Status of the Pikachu entity is 'dropped'.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000; // 5 min threshold
    const sessionStart = t0;
    const sessionEnd = t0 + 15 * 60 * 1000;

    // Build HR series. 5s tick interval => 180 ticks over 15 min.
    // Ticks 0..119 = Pikachu data, ticks 120..179 = test-friend data.
    const pikachuHr = [
      ...Array(120).fill(130),
      ...Array(60).fill(null)
    ];
    const friendHr = [
      ...Array(120).fill(null),
      ...Array(60).fill(140)
    ];

    const sessionData = {
      sessionId: 'fs_20260526000000',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: '#90006', name: 'Pikachu', isGuest: true, hrDeviceId: '90006' },
        { profileId: 'test-friend', name: 'Test Friend', hrDeviceId: '90006' }
      ],
      deviceAssignments: [
        // Live ledger only reflects the latest assignment on each device.
        { deviceId: '90006', occupantId: 'test-friend', occupantName: 'Test Friend' }
      ],
      entities: [
        // Per-device segment history. Pikachu segment ended status:'dropped'
        // (exceeded threshold). test-friend segment is the active one.
        {
          entityId: 'entity-pikachu-1',
          profileId: '#90006',
          name: 'Pikachu',
          deviceId: '90006',
          startTime: sessionStart,
          endTime: sessionStart + 10 * 60 * 1000,
          status: 'dropped',
          coins: 0
        },
        {
          entityId: 'entity-test-friend-1',
          profileId: 'test-friend',
          name: 'Test Friend',
          deviceId: '90006',
          startTime: sessionStart + 10 * 60 * 1000,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: {
          startTime: sessionStart,
          intervalMs: 5000,
          tickCount: 180
        },
        series: {
          'user:#90006:heart_rate': pikachuHr,
          'user:test-friend:heart_rate': friendHr
        },
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

    // Per Decision §5: late tagging means "I'm telling you now who this
    // was". Saved YAML must contain ONLY test-friend — the Pikachu
    // participant is absorbed forward into test-friend regardless of duration.
    const participantIds = Object.keys(capturedPayload.participants || {});
    expect(participantIds).toContain('test-friend');
    // No synthetic / Pikachu identifiers remain.
    expect(participantIds.some((id) => id.startsWith('#') || id.startsWith('guest-'))).toBe(false);
  });

  it('does NOT merge when both segments are real configured users (no Pikachu involved)', async () => {
    // Sanity check: two real users with sub-threshold (would absorb forward
    // for non-Pikachu reasons), but if BOTH segments exceed threshold and
    // neither is a Pikachu, they should both remain.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000;
    const sessionStart = t0;
    const sessionEnd = t0 + 20 * 60 * 1000;

    const sessionData = {
      sessionId: 'fs_20260526000001',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: 'alice', name: 'Alice', hrDeviceId: '90006' },
        { profileId: 'bob', name: 'Bob', hrDeviceId: '90006' }
      ],
      deviceAssignments: [
        { deviceId: '90006', occupantId: 'bob', occupantName: 'Bob' }
      ],
      entities: [
        {
          entityId: 'entity-alice-1',
          profileId: 'alice',
          name: 'Alice',
          deviceId: '90006',
          startTime: sessionStart,
          endTime: sessionStart + 10 * 60 * 1000,
          status: 'dropped',
          coins: 0
        },
        {
          entityId: 'entity-bob-1',
          profileId: 'bob',
          name: 'Bob',
          deviceId: '90006',
          startTime: sessionStart + 10 * 60 * 1000,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: { startTime: sessionStart, intervalMs: 5000, tickCount: 240 },
        series: {
          'user:alice:heart_rate': [...Array(120).fill(130), ...Array(120).fill(null)],
          'user:bob:heart_rate':   [...Array(120).fill(null), ...Array(120).fill(140)]
        },
        events: []
      },
      thresholdMs: T
    };

    pm.persistSession(sessionData, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const participantIds = Object.keys(capturedPayload.participants || {});
    // Both should remain — both exceeded threshold and neither is a Pikachu.
    expect(participantIds).toContain('alice');
    expect(participantIds).toContain('bob');
  });

  it('does NOT re-transfer when an in-session grace-period transfer already moved the data (status:transferred short-circuit)', async () => {
    // Invariant guarded by this test: the save-time backfill must skip
    // segments where the in-session GuestAssignmentService grace-period flow
    // already absorbed the Pikachu data into the configured user. The Pikachu
    // entity carries `status: 'transferred'`, its series cells are already
    // null, and the destination (test-friend) carries the merged HR data.
    //
    // A future refactor that drops the `inSessionTransferred` skip would
    // either (a) emit a redundant transfer, (b) overwrite test-friend's
    // already-merged data, or (c) double-count. This test fails on any of
    // those regressions.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000; // 5 min
    const sessionStart = t0;
    const sessionEnd = t0 + 15 * 60 * 1000;

    // Series state mirrors what FitnessTimeline.transferUserSeries leaves
    // behind after the in-session transfer: source nulled out, destination
    // carries the merged values.
    const mergedHr = [
      ...Array(120).fill(130),   // Pikachu's 10 min, already moved here
      ...Array(60).fill(140)     // test-friend's own 5 min
    ];
    const pikachuHr = new Array(180).fill(null);

    // Snapshot pre-persist state so we can assert no further mutation.
    const mergedHrSnapshot = [...mergedHr];

    const sessionData = {
      sessionId: 'fs_20260526000099',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: '#90006', name: 'Pikachu', isGuest: true, hrDeviceId: '90006' },
        { profileId: 'test-friend', name: 'Test Friend', hrDeviceId: '90006' }
      ],
      deviceAssignments: [
        { deviceId: '90006', occupantId: 'test-friend', occupantName: 'Test Friend' }
      ],
      entities: [
        {
          entityId: 'entity-pikachu-1',
          profileId: '#90006',
          name: 'Pikachu',
          deviceId: '90006',
          startTime: sessionStart,
          endTime: sessionStart + 10 * 60 * 1000,
          // KEY: the in-session grace-period flow already absorbed this
          // segment. The save-time backfill MUST short-circuit it.
          status: 'transferred',
          coins: 0
        },
        {
          entityId: 'entity-test-friend-1',
          profileId: 'test-friend',
          name: 'Test Friend',
          deviceId: '90006',
          startTime: sessionStart + 10 * 60 * 1000,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: {
          startTime: sessionStart,
          intervalMs: 5000,
          tickCount: 180
        },
        series: {
          'user:#90006:heart_rate': pikachuHr,
          'user:test-friend:heart_rate': mergedHr
        },
        events: []
      },
      thresholdMs: T
    };

    pm.persistSession(sessionData, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCallCount).toBe(1);
    expect(capturedPayload).toBeTruthy();

    // 1. The backfill MUST NOT emit any transfer for the already-transferred
    //    Pikachu → test-friend pair. The pikachu entity's only segment is
    //    in-session-transferred and excluded from the analysis window, so
    //    both detectCyclingSegments and applyAbsorbRules skip it.
    //
    //    A backfill_applied event may still fire (the pikachu profile is
    //    removed from the participant list because it has no kept segments
    //    anywhere), but the `transfers` list MUST be empty for this pair.
    const backfillEvent = logEvents.find(e => e.eventName === 'persist_backfill_applied');
    if (backfillEvent) {
      const transfers = backfillEvent.data?.transfers || [];
      const redundant = transfers.find(
        t => t.fromOccupantId === '#90006' && t.toOccupantId === 'test-friend'
      );
      expect(redundant).toBeUndefined();
      // Also assert no other spurious transfers — the only legitimate
      // bookkeeping is removing the already-transferred pikachu from the
      // participants block.
      expect(transfers).toEqual([]);
    }

    // 2. test-friend's merged data must be intact — destination-wins merge
    //    on an all-null source is a no-op, so even if a transfer DID fire
    //    we wouldn't lose data; this asserts the no-mutation invariant.
    //    _applyBackfill mutates sessionData.timeline.series in-place before
    //    serialization, so we read it directly from the live reference.
    const liveFriendHr = sessionData.timeline.series['user:test-friend:heart_rate'];
    expect(liveFriendHr).toEqual(mergedHrSnapshot);

    // 2b. The persisted payload must surface test-friend's HR series.
    //     mapSeriesKeysForPersist rewrites `user:test-friend:heart_rate` →
    //     `test-friend:hr`. We just verify presence here; content was already
    //     checked on the live series above.
    const persistedHrSeries = capturedPayload.timeline?.series?.['test-friend:hr'];
    expect(persistedHrSeries).toBeTruthy();

    // 3. No backfill_failed events.
    const failedEvent = logEvents.find(e => e.eventName === 'fitness.persistence.backfill_failed');
    expect(failedEvent).toBeUndefined();

    // 4. test-friend is the surviving participant; Pikachu is dropped
    //    (because its only segment was in-session-transferred and is
    //    excluded from collectKeptOccupants).
    const participantIds = Object.keys(capturedPayload.participants || {});
    expect(participantIds).toContain('test-friend');
    expect(participantIds.some((id) => id.startsWith('#') || id.startsWith('guest-'))).toBe(false);
  });
});
