/**
 * Golden-parity fixture test — real session 20260627195941 (2026-06-27,
 * Jane Fonda "Complete Workout"), trimmed to the 3 human occupants sharing
 * HR-strap device 10001: grannie (primary, full continuous trace, 966
 * rings), learner1 (2 HR samples then dropped strap), parent-two (1 HR sample
 * then dropped strap).
 *
 * This is the in-memory-shape counterpart to the backend's
 * `backend/src/2_domains/fitness/services/SessionIdentityHealer.golden.test.mjs`
 * — same underlying session, decoded to plain arrays and renamed to the
 * `user:<id>:...` series-key convention `runSessionBackfill` expects. Both
 * engines must independently agree: learner1 and parent-two are ghost occupants
 * absorbed away, grannie is the real occupant who is kept.
 */
import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';
import fixture from './__fixtures__/session-20260627195941.json';

describe('runSessionBackfill golden parity — session 20260627195941', () => {
  it('removes the two ghost occupants (learner1, parent-two) and keeps grannie', () => {
    const { entities, timeline, endTime } = fixture;
    const result = runSessionBackfill({
      entities,
      series: timeline.series,
      sessionEndTime: endTime
    });

    // Sorted on both sides: the actual is sorted above, so the expectation must be
    // too. (It read as sorted under the pre-scrub names and silently stopped being
    // sorted when they were replaced — the assertion is order-insensitive by intent.)
    expect([...result.removedOccupants].sort()).toEqual(['learner1', 'parent-two']);
    expect(result.keptOccupants).toContain('grannie');
    expect(result.removedOccupants).not.toContain('grannie');
  });
});

describe('runSessionBackfill — relabelled stints (2026-09-23 stint attribution)', () => {
  it('honours a relabelled stint even with high effort and drops relabelled-away names', () => {
    const series = {
      'user:kid-a:heart_rate': [150, 150, 150], 'user:kid-a:rings_total': [0, 44, 88], 'user:kid-a:zone_id': ['warm', 'warm', 'warm'],
      'user:kid-b:heart_rate': [null, null, null], 'user:kid-b:rings_total': [0, 0, 0],
      'user:kid-d:heart_rate': [null, null, null], 'user:kid-d:rings_total': [0, 0, 0],
      'user:guest-c:heart_rate': [140, 140, 140], 'user:guest-c:rings_total': [0, 20, 40], 'user:guest-c:zone_id': ['warm', 'warm', 'warm'],
    };
    const entities = [
      { entityId: 'e2', profileId: 'kid-a', deviceId: 'D2', startTime: 1000, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-a', 'kid-b'] },
      { entityId: 'e1', profileId: 'guest-c', deviceId: 'D1', startTime: 1000, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-d'] },
    ];
    const r = runSessionBackfill({ entities, series, thresholdMs: 300000, sessionEndTime: 99999 });
    expect(r.removedOccupants.has('kid-a')).toBe(false);
    expect(r.removedOccupants.has('guest-c')).toBe(false);
    expect(r.removedOccupants.has('kid-b')).toBe(true);
    expect(r.removedOccupants.has('kid-d')).toBe(true);
    expect(r.transfers.find((t) => t.fromOccupantId === 'kid-a' || t.fromOccupantId === 'guest-c')).toBeUndefined();
  });

  it('keeps a relabelled stint even when its effort is insignificant', () => {
    const series = { 'user:kid-a:heart_rate': [null, 90, null], 'user:kid-a:rings_total': [0, 0, 0] };
    const entities = [
      { entityId: 'e2', profileId: 'kid-a', deviceId: 'D2', startTime: 1000, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-b'] },
      { entityId: 'e3', profileId: 'kid-z', deviceId: 'D2', startTime: 2000, endTime: null, status: 'active', startTick: 1 },
    ];
    const r = runSessionBackfill({ entities, series, thresholdMs: 300000, sessionEndTime: 99999 });
    expect(r.removedOccupants.has('kid-a')).toBe(false);
  });
});
