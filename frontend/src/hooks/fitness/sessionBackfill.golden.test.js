/**
 * Golden-parity fixture test — real session 20260627195941 (2026-06-27,
 * Jane Fonda "Complete Workout"), trimmed to the 3 human occupants sharing
 * HR-strap device 90005: grannie (primary, full continuous trace, 966
 * coins), user_5 (2 HR samples then dropped strap), user_9 (1 HR sample
 * then dropped strap).
 *
 * This is the in-memory-shape counterpart to the backend's
 * `backend/src/2_domains/fitness/services/SessionIdentityHealer.golden.test.mjs`
 * — same underlying session, decoded to plain arrays and renamed to the
 * `user:<id>:...` series-key convention `runSessionBackfill` expects. Both
 * engines must independently agree: user_5 and user_9 are ghost occupants
 * absorbed away, grannie is the real occupant who is kept.
 */
import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';
import fixture from './__fixtures__/session-20260627195941.json';

describe('runSessionBackfill golden parity — session 20260627195941', () => {
  it('removes the two ghost occupants (user_9, user_5) and keeps grannie', () => {
    const { entities, timeline, endTime } = fixture;
    const result = runSessionBackfill({
      entities,
      series: timeline.series,
      sessionEndTime: endTime
    });

    expect([...result.removedOccupants].sort()).toEqual(['user_9', 'user_5']);
    expect(result.keptOccupants).toContain('grannie');
    expect(result.removedOccupants).not.toContain('grannie');
  });
});
