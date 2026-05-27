/**
 * W1.B / OI-2 — cycling / turn-taking detection at session save time.
 *
 * Scenario: 3+ consecutive sub-threshold segments alternate between 2+
 * distinct occupants on a single device. The naive forward-absorb rule
 * would cascade everything into the final occupant. Cycling detection
 * recognises the pattern (turn-taking on a shared device) and honours all
 * segments → both occupants appear in the saved participants block.
 *
 * Drives PersistenceManager directly; mirrors the late-tag test shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../lib/clientId.js', () => ({
  getClientId: () => 'test-client'
}));

const { PersistenceManager } = await import('./PersistenceManager.js');

describe('PersistenceManager — cycling/turn-taking detection (W1.B / OI-2)', () => {
  let pm;
  let capturedPayload;

  beforeEach(() => {
    capturedPayload = null;
    pm = new PersistenceManager({
      persistApi: vi.fn().mockImplementation(async (url, body) => {
        if (url === 'api/v1/fitness/save_session') {
          capturedPayload = body?.sessionData;
        }
        return { ok: true };
      })
    });
    pm.setUsageThresholdMs(5 * 60 * 1000); // 5 minutes
  });

  it('honors all segments when 3+ consecutive sub-T alternations between 2 occupants are detected', async () => {
    // Alice-Bob-Alice-Bob-Alice, each 2-min segments on device 48291.
    // Threshold = 5 min → each segment is sub-T. Strict forward-absorb would
    // cascade Alice→Bob→Alice→Bob→Alice, leaving only the final Alice.
    // Cycling detection (3+ consecutive sub-T, 2+ distinct occupants) honors
    // all 5 → both Alice and Bob in the saved participants.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000;
    const segDuration = 2 * 60 * 1000; // 2 min
    const sessionStart = t0;
    const sessionEnd = t0 + 5 * segDuration;

    // 5s tick interval → 24 ticks per segment, 120 ticks total.
    const series = {};
    for (const slug of ['alice', 'bob']) {
      series[`user:${slug}:heart_rate`] = new Array(120).fill(null);
    }
    for (let seg = 0; seg < 5; seg++) {
      const slug = seg % 2 === 0 ? 'alice' : 'bob';
      const hr = 120 + seg;
      const startTick = seg * 24;
      for (let i = 0; i < 24; i++) {
        series[`user:${slug}:heart_rate`][startTick + i] = hr;
      }
    }

    const entities = [];
    for (let seg = 0; seg < 5; seg++) {
      const occupantId = seg % 2 === 0 ? 'alice' : 'bob';
      entities.push({
        entityId: `entity-${seg}-${occupantId}`,
        profileId: occupantId,
        name: occupantId === 'alice' ? 'Alice' : 'Bob',
        deviceId: '48291',
        startTime: sessionStart + seg * segDuration,
        endTime: sessionStart + (seg + 1) * segDuration,
        // Each transition exceeded grace logic in-session? Actually NO — they
        // were sub-T. But this test simulates the case where in-session
        // transfers DID happen (status = transferred) we'd want to NOT
        // double-process. The clearer case: status = dropped, leaving the
        // save-time pass to recognise cycling.
        // Setting status='dropped' for all but the last to mirror the
        // GUEST_REPLACED path. (In-session transfer would set 'transferred'
        // — but the in-session threshold check uses the same threshold;
        // if these were sub-T, the in-session flow WOULD have transferred.
        // For cycling to matter, we model the case where the in-session
        // flow didn't transfer — e.g. because the data came in as separate
        // assignments rapidly enough that the in-session check missed, or
        // because the user is opting into save-time disambiguation.)
        status: seg === 4 ? 'active' : 'dropped',
        coins: 0
      });
    }

    const sessionData = {
      sessionId: 'fs_20260526000002',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: 'alice', name: 'Alice', hrDeviceId: '48291' },
        { profileId: 'bob', name: 'Bob', hrDeviceId: '48291' }
      ],
      deviceAssignments: [
        { deviceId: '48291', occupantId: 'alice', occupantName: 'Alice' }
      ],
      entities,
      timeline: {
        timebase: { startTime: sessionStart, intervalMs: 5000, tickCount: 120 },
        series,
        events: []
      },
      thresholdMs: T
    };

    pm.persistSession(sessionData, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedPayload).toBeTruthy();
    const participantIds = Object.keys(capturedPayload.participants || {});

    // Cycling detected → BOTH Alice and Bob honored despite each segment
    // being sub-threshold.
    expect(participantIds).toContain('alice');
    expect(participantIds).toContain('bob');
  });

  it('OI-1 — final sub-threshold segment is backfilled BACKWARD into the prior honored occupant', async () => {
    // test-user-a 3m → test-user-b 30m → Guest 2m, threshold = 5m.
    //   - test-user-a segment is sub-T but has a successor (test-user-b).
    //     Per OI-3, test-user-a absorbs forward into test-user-b.
    //   - test-user-b segment is over threshold → honored.
    //   - Guest segment is sub-T AND final → per OI-1, backfills backward
    //     into test-user-b (the prior honored).
    // Final saved participants: just test-user-b.
    const t0 = 1_700_000_000_000;
    const T = 5 * 60 * 1000;
    const sessionStart = t0;
    const aEnd = t0 + 3 * 60 * 1000;
    const bEnd = aEnd + 30 * 60 * 1000;
    const sessionEnd = bEnd + 2 * 60 * 1000;

    // 5s tick: 35 min = 420 ticks total.
    const series = {
      'user:test-user-a:heart_rate': [
        ...Array(36).fill(110),   // 3 min
        ...Array(384).fill(null)
      ],
      'user:test-user-b:heart_rate': [
        ...Array(36).fill(null),
        ...Array(360).fill(140),  // 30 min
        ...Array(24).fill(null)
      ],
      'user:#guest123:heart_rate': [
        ...Array(396).fill(null),
        ...Array(24).fill(120)     // 2 min
      ]
    };

    const sessionData = {
      sessionId: 'fs_20260526000003',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        { profileId: 'test-user-a', name: 'Test User A', hrDeviceId: '48291' },
        { profileId: 'test-user-b', name: 'Test User B', hrDeviceId: '48291' },
        { profileId: '#guest123', name: 'Guest', isGuest: true, hrDeviceId: '48291' }
      ],
      deviceAssignments: [
        { deviceId: '48291', occupantId: '#guest123', occupantName: 'Guest' }
      ],
      entities: [
        {
          entityId: 'entity-test-user-a-1',
          profileId: 'test-user-a',
          name: 'Test User A',
          deviceId: '48291',
          startTime: sessionStart,
          endTime: aEnd,
          status: 'dropped',
          coins: 0
        },
        {
          entityId: 'entity-test-user-b-1',
          profileId: 'test-user-b',
          name: 'Test User B',
          deviceId: '48291',
          startTime: aEnd,
          endTime: bEnd,
          status: 'dropped',
          coins: 0
        },
        {
          entityId: 'entity-guest123-1',
          profileId: '#guest123',
          name: 'Guest',
          deviceId: '48291',
          startTime: bEnd,
          endTime: sessionEnd,
          status: 'active',
          coins: 0
        }
      ],
      timeline: {
        timebase: { startTime: sessionStart, intervalMs: 5000, tickCount: 420 },
        series,
        events: []
      },
      thresholdMs: T
    };

    pm.persistSession(sessionData, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedPayload).toBeTruthy();
    const participantIds = Object.keys(capturedPayload.participants || {});

    // test-user-b is the only honored occupant. test-user-a (sub-T, absorbed
    // forward into test-user-b) and #guest123 (sub-T final, backfilled
    // backward into test-user-b) are both removed.
    expect(participantIds).toContain('test-user-b');
    expect(participantIds).not.toContain('test-user-a');
    expect(participantIds).not.toContain('#guest123');
  });
});
