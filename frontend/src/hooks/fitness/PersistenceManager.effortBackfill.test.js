/**
 * Task 4 — live save path wires the effort-based reconciliation
 * (runSessionBackfill's series-aware path) into PersistenceManager._applyBackfill.
 *
 * Scenario: a synthetic/ghost participant ("elizabeth") shows up on a device
 * for a handful of ticks with essentially no effort (1 HR sample, 0 coins,
 * no active-zone time) before the device is properly claimed by "grannie",
 * who accrues a full session's worth of data. Duration alone (the legacy
 * threshold-only backfill) would NOT necessarily absorb elizabeth's segment
 * forward — it's the EFFORT-based rule (Task 1-3's runSessionBackfill +
 * DEFAULT_INSIGNIFICANT_USAGE) that catches this. Prior to Task 4,
 * PersistenceManager._applyBackfill never passed `series` into
 * runSessionBackfill, so this ghost would crystallize into the saved
 * participants list.
 *
 * After persist:
 *   - capturedPayload.summary.participants has no 'elizabeth' key.
 *   - capturedPayload.participants has no 'elizabeth' key.
 *   - sessionData.timeline.series['user:elizabeth:heart_rate'] (live, mutated
 *     in-place before RLE encoding) is emptied to all-null.
 *   - grannie's data survives untouched (destination-wins merge).
 *
 * Harness copied from PersistenceManager.lateTagMerge.test.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../lib/clientId.js', () => ({
  getClientId: () => 'test-client'
}));

const { PersistenceManager } = await import('./PersistenceManager.js');

describe('PersistenceManager — effort-based reconciliation on the live save path (Task 4)', () => {
  let pm;
  let capturedPayload;
  let apiCallCount;

  beforeEach(() => {
    capturedPayload = null;
    apiCallCount = 0;
    pm = new PersistenceManager({
      persistApi: vi.fn().mockImplementation(async (url, body) => {
        if (url === 'api/v1/fitness/save_session') {
          capturedPayload = body?.sessionData;
          apiCallCount++;
        }
        return { ok: true };
      }),
      onLog: () => {}
    });
    pm.setUsageThresholdMs(5 * 60 * 1000); // 5 minutes
  });

  it('drops a zero-effort ghost occupant (elizabeth) and folds her forward into grannie', async () => {
    // NOTE: elizabeth's segment is deliberately LONGER than the configured
    // usage threshold (5 min) so the legacy duration-only backfill rule
    // (no `series` input) would NOT absorb her — she's not "sub-threshold"
    // by duration. It's only the EFFORT-based rule (near-zero HR samples /
    // coins / active-zone time, from Task 1-3's runSessionBackfill effort
    // path) that correctly identifies her as a ghost (e.g. a sensor that
    // stayed connected but was never actually worn/used). This is the exact
    // regression Task 4 closes: prior to wiring `series` through, this
    // ghost would have crystallized into the saved participants list.
    const t0 = 1_700_000_000_000;
    const sessionStart = t0;
    const sessionEnd = t0 + 15 * 60 * 1000; // 15 min
    const intervalMs = 5000;
    const tickCount = 180; // 15 min / 5s

    // elizabeth: first 10 min (120 ticks) on device 29413 — 1 HR sample, 0 coins.
    const elizabethEnd = sessionStart + 10 * 60 * 1000;
    // grannie: claims the device for the remaining 5 min, full data.
    const grannieStart = elizabethEnd;

    const elizabethHr = new Array(tickCount).fill(null);
    elizabethHr[0] = 70; // single sample — well under DEFAULT_INSIGNIFICANT_USAGE.maxHrSamples (3)

    const grannieHr = new Array(tickCount).fill(null);
    for (let i = 120; i < tickCount; i++) grannieHr[i] = 130;

    const sessionData = {
      sessionId: 'fs_20260715000000',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: 'elizabeth', name: 'Elizabeth', hrDeviceId: '29413' },
        { profileId: 'grannie', name: 'Grannie', hrDeviceId: '29413' }
      ],
      deviceAssignments: [
        { deviceId: '29413', occupantId: 'grannie', occupantName: 'Grannie' }
      ],
      entities: [
        {
          entityId: 'entity-elizabeth-1',
          profileId: 'elizabeth',
          name: 'Elizabeth',
          deviceId: '29413',
          startTime: sessionStart,
          endTime: elizabethEnd,
          status: 'active',
          coins: 0
        },
        {
          entityId: 'entity-grannie-1',
          profileId: 'grannie',
          name: 'Grannie',
          deviceId: '29413',
          startTime: grannieStart,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: {
          startTime: sessionStart,
          intervalMs,
          tickCount
        },
        interval_seconds: 5,
        series: {
          'user:elizabeth:heart_rate': elizabethHr,
          'user:grannie:heart_rate': grannieHr
        },
        events: []
      },
      thresholdMs: 5 * 60 * 1000
    };

    const accepted = pm.persistSession(sessionData, { force: true });
    expect(accepted).toBe(true);

    // Drain microtasks so the persistApi Promise chain resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCallCount).toBe(1);
    expect(capturedPayload).toBeTruthy();

    // Ghost is excluded from both the top-level participants block and the
    // computed summary.
    const participantIds = Object.keys(capturedPayload.participants || {});
    expect(participantIds).not.toContain('elizabeth');
    expect(participantIds).toContain('grannie');

    const summaryParticipantIds = Object.keys(capturedPayload.summary?.participants || {});
    expect(summaryParticipantIds).not.toContain('elizabeth');
    expect(summaryParticipantIds).toContain('grannie');

    // The live series (mutated in-place before RLE encoding) shows
    // elizabeth's heart_rate series fully emptied...
    const liveElizabethHr = sessionData.timeline.series['user:elizabeth:heart_rate'];
    expect(liveElizabethHr.every((v) => v == null)).toBe(true);

    // ...while grannie's own data survives (destination-wins merge; her
    // segment's values are untouched since elizabeth had nothing but nulls
    // where grannie has real values).
    const liveGrannieHr = sessionData.timeline.series['user:grannie:heart_rate'];
    for (let i = 120; i < tickCount; i++) {
      expect(liveGrannieHr[i]).toBe(130);
    }
  });
});
