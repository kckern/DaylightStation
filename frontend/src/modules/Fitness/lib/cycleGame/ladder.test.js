import { describe, it, expect } from 'vitest';
import { courseStartOverride, pickRival, ladderDelta, daysLeft } from './ladder.js';

const ROWS = [
  { userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 2 },
  { userId: 'mom', bestValue: 165, raceId: 'r2', attempts: 1 },
  { userId: 'user_3', bestValue: 190, raceId: 'r3', attempts: 3 }
];

describe('courseStartOverride', () => {
  it('maps distance and time courses to the startRace override shape', () => {
    expect(courseStartOverride({ id: 'c1', win_condition: 'distance', goal_m: 1500 }))
      .toEqual({ id: 'c1', win_condition: 'distance', goal_m: 1500, time_cap_s: null });
    expect(courseStartOverride({ id: 'c2', win_condition: 'time', time_cap_s: 300 }))
      .toEqual({ id: 'c2', win_condition: 'time', goal_m: null, time_cap_s: 300 });
  });
});

describe('pickRival', () => {
  it('rung above for a ranked rider; self-pb for the leader; tail for unranked; none when empty', () => {
    expect(pickRival({ standings: ROWS, riderId: 'user_3' })).toEqual({ kind: 'above', raceId: 'r2', rivalUserId: 'mom' });
    expect(pickRival({ standings: ROWS, riderId: 'dad' })).toEqual({ kind: 'self-pb', raceId: null, rivalUserId: 'dad' });
    expect(pickRival({ standings: ROWS, riderId: 'newkid' })).toEqual({ kind: 'tail', raceId: 'r3', rivalUserId: 'user_3' });
    expect(pickRival({ standings: [], riderId: 'dad' })).toEqual({ kind: 'none', raceId: null, rivalUserId: null });
  });

  it('with no rider assigned (riderId: null), arms the bottom rung (tail) — accepted: startRace no-ops with a no_riders warn when no bike is claimed, so an armed-but-unused ghost is harmless', () => {
    expect(pickRival({ standings: ROWS, riderId: null })).toEqual({ kind: 'tail', raceId: 'r3', rivalUserId: 'user_3' });
  });
});

describe('ladderDelta', () => {
  it('reports rank, movement, and gap to the rung above', () => {
    const before = [ROWS[0], ROWS[2], ROWS[1]]; // user_3 was 2nd
    const d = ladderDelta({ before, after: ROWS, userId: 'mom' });
    expect(d).toEqual({ rank: 2, prevRank: 3, movedUp: true, isLead: false, aboveUserId: 'dad', gapToAbove: 15 });
    expect(ladderDelta({ before, after: ROWS, userId: 'dad' }).isLead).toBe(true);
    expect(ladderDelta({ before, after: ROWS, userId: 'nobody' })).toBeNull();
  });
});

describe('daysLeft', () => {
  it('whole days to the exclusive end date, floored at 0', () => {
    expect(daysLeft('2026-07-06', new Date(2026, 6, 1, 12))).toBe(5);
    expect(daysLeft('2026-07-06', new Date(2026, 6, 5, 23))).toBe(1);
    expect(daysLeft('2026-07-06', new Date(2026, 6, 7))).toBe(0);
  });
});
