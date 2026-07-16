/**
 * Golden-parity fixture test — real session 20260627195941 (2026-06-27,
 * Jane Fonda "Complete Workout"), trimmed to the 3 human occupants sharing
 * HR-strap device 29413: grannie (primary, full continuous trace, 966
 * coins), soren (2 HR samples then dropped strap), elizabeth (1 HR sample
 * then dropped strap).
 *
 * This is the in-memory-shape counterpart to the backend's
 * `backend/src/2_domains/fitness/services/SessionIdentityHealer.golden.test.mjs`
 * — same underlying session, decoded to plain arrays and renamed to the
 * `user:<id>:...` series-key convention `runSessionBackfill` expects. Both
 * engines must independently agree: soren and elizabeth are ghost occupants
 * absorbed away, grannie is the real occupant who is kept.
 */
import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';
import fixture from './__fixtures__/session-20260627195941.json';

describe('runSessionBackfill golden parity — session 20260627195941', () => {
  it('removes the two ghost occupants (elizabeth, soren) and keeps grannie', () => {
    const { entities, timeline, endTime } = fixture;
    const result = runSessionBackfill({
      entities,
      series: timeline.series,
      sessionEndTime: endTime
    });

    expect([...result.removedOccupants].sort()).toEqual(['elizabeth', 'soren']);
    expect(result.keptOccupants).toContain('grannie');
    expect(result.removedOccupants).not.toContain('grannie');
  });
});
