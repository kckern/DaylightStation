// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { earnedLines } from './earnedLines.mjs';

const week = (lines, silver) => ({ totals: { silver, gems: 0 }, lines: lines.map(([ruleId, label, s, g = 0, status = 'earned']) => ({ ruleId, label, status, amount: { silver: s, gems: g } })) });

describe('earnedLines', () => {
  it('one line per rule whose amount rose, and the week total after', () => {
    const before = week([['korean', 'Korean (each day done)', 0], ['green-day', 'Each green day', 0]], 18);
    const after = week([['korean', 'Korean (each day done)', 2], ['green-day', 'Each green day', 5]], 25);
    expect(earnedLines(before, after)).toEqual({
      lines: [{ label: 'Korean (each day done)', silver: 2, gems: 0 }, { label: 'Each green day', silver: 5, gems: 0 }],
      weekSilver: 25,
    });
  });
  it('nothing rose: only the total', () => {
    const w = week([['korean', 'Korean (each day done)', 2]], 18);
    expect(earnedLines(w, w)).toEqual({ lines: [], weekSilver: 18 });
  });
  it('no before (a re-settle): only the total; no after: nothing', () => {
    expect(earnedLines(null, week([], 9))).toEqual({ lines: [], weekSilver: 9 });
    expect(earnedLines(week([], 9), null)).toBeNull();
  });
  it('counts only earned amounts: a pending line (a contest still being decided) never prints', () => {
    const before = week([['contest', 'Most rings', 0, 0, 'pending'], ['korean', 'Korean (each day done)', 0]], 18);
    const after = week([['contest', 'Most rings', 10, 0, 'pending'], ['korean', 'Korean (each day done)', 2]], 20);
    expect(earnedLines(before, after).lines).toEqual([{ label: 'Korean (each day done)', silver: 2, gems: 0 }]);
  });
  it('a line that turns from pending to earned prints its whole earned amount', () => {
    const before = week([['green', 'Whole day done', 5, 0, 'pending']], 18);
    const after = week([['green', 'Whole day done', 5, 0, 'earned']], 23);
    expect(earnedLines(before, after).lines).toEqual([{ label: 'Whole day done', silver: 5, gems: 0 }]);
  });
});
