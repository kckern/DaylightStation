import { describe, it, expect } from 'vitest';
import { courseStartOverride, pickRival, onlyParticipant, ladderDelta, daysLeft } from "./ladder.js";

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

describe('pickRival — the weekly-course ghost (2026-11-11: "Ride it" always races the leader)', () => {
  it("the week's leader when the leader is not on a bike, whoever is riding", () => {
    expect(pickRival({ standings: ROWS, riderIds: ['user_3'] })).toEqual({ kind: 'leader', raceId: 'r1', rivalUserId: 'dad' });
    expect(pickRival({ standings: ROWS, riderIds: ['mom', 'newkid'] })).toEqual({ kind: 'leader', raceId: 'r1', rivalUserId: 'dad' });
    expect(pickRival({ standings: ROWS, riderIds: [] })).toEqual({ kind: 'leader', raceId: 'r1', rivalUserId: 'dad' });
  });

  it('leader on a bike: the best run by anyone not riding', () => {
    expect(pickRival({ standings: ROWS, riderIds: ['dad', 'newkid'] })).toEqual({ kind: 'best-not-riding', raceId: 'r2', rivalUserId: 'mom' });
    expect(pickRival({ standings: ROWS, riderIds: ['dad', 'mom'] })).toEqual({ kind: 'best-not-riding', raceId: 'r3', rivalUserId: 'user_3' });
  });

  it("everyone on the ladder is riding: the leader's own record, as a ghost", () => {
    expect(pickRival({ standings: ROWS, riderIds: ['dad', 'mom', 'user_3'] })).toEqual({ kind: 'leader-own-record', raceId: 'r1', rivalUserId: 'dad' });
  });

  it('no runs this week: no ghost', () => {
    expect(pickRival({ standings: [], riderIds: ['dad'] })).toEqual({ kind: 'none', raceId: null, rivalUserId: null });
  });

  it('a rung with no raceId is skipped', () => {
    const rows = [{ userId: 'dad', bestValue: 150, raceId: null }, ROWS[1]];
    expect(pickRival({ standings: rows, riderIds: [] })).toEqual({ kind: 'best-not-riding', raceId: 'r2', rivalUserId: 'mom' });
  });
});

describe('onlyParticipant', () => {
  it("keeps only the rival's own line from the record (no co-riders, no ghosts they raced)", () => {
    const cand = { raceId: 'r1', participants: [{ id: 'user_3' }, { id: 'ghost:r0:user_4' }] };
    expect(onlyParticipant(cand, 'user_3').participants).toEqual([{ id: 'user_3' }]);
    expect(onlyParticipant(cand, 'nobody')).toBeNull();
    expect(onlyParticipant(null, 'user_3')).toBeNull();
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
