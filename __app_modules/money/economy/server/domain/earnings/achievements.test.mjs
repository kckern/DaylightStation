// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings, buildGemBoard } from './index.mjs';
import { payoutMeta } from '../../application/PayoutService.mjs';

const WEEK = { from: '2026-11-02', to: '2026-11-08' };
const RINGS_WEEK = { from: '2026-11-02T12:00:00.000Z', to: '2026-11-07T20:00:00.000Z' };
const ruleset = (rules) => validateRuleset({ revision: 6, rules });
const line = (out, id) => out.lines.find((l) => l.ruleId === id);

function evaluate(rs, achievements, extra = {}) {
  return evaluateEarnings({
    ruleset: rs, learnerId: 'kid',
    facts: { sectionDays: [], days: [], week: null, units: [], rings: null, achievements },
    windows: { school: WEEK, rings: RINGS_WEEK }, today: '2026-11-04', ...extra,
  });
}

describe('validation', () => {
  it('needs an activity the kind knows, and checks days, cap and tie', () => {
    expect(() => ruleset([{ id: 'x', kind: 'activity-days', reward: 1 }])).toThrow(/activity/);
    expect(() => ruleset([{ id: 'x', kind: 'milestone', match: { activity: 'card-goal' }, reward: 1 }])).toThrow(/activity/);
    expect(() => ruleset([{ id: 'x', kind: 'activity-days', match: { activity: 'card-goal' }, days: 9, reward: 1 }])).toThrow(/days/);
    expect(() => ruleset([{ id: 'x', kind: 'milestone', match: { activity: 'race-pb' }, cap: { count: 0 }, reward: 1 }])).toThrow(/cap/);
    expect(() => ruleset([{ id: 'x', kind: 'activity-contest', match: { activity: 'race' }, tie: 'coin', reward: 1 }])).toThrow(/tie/);
    const rs = ruleset([
      { id: 'a', kind: 'activity-days', match: { activity: 'card-goal' }, reward: { gems: 1 } },
      { id: 'b', kind: 'milestone', match: { activity: 'race-pb' }, cap: { count: 2 }, reward: { gems: 1 } },
    ]);
    expect(rs.rules[0]).toMatchObject({ days: 4, match: { activity: 'card-goal' } });
    expect(rs.rules[1].cap).toEqual({ per: 'week', count: 2 });
  });
});

describe('activity-days', () => {
  const rs = ruleset([{ id: 'cards', kind: 'activity-days', match: { activity: 'card-goal' }, days: 3, reward: { gems: 1 } }]);
  it('earns at the count, counting each day once', () => {
    const out = evaluate(rs, { days: { 'card-goal': ['2026-11-02', '2026-11-03', '2026-11-03', '2026-11-04'] }, milestones: {} });
    expect(line(out, 'cards')).toMatchObject({ status: 'earned', count: 1, amount: { gems: 1 }, progress: { have: 3, need: 3 } });
  });
  it('pending in the week, none once it is over short, indeterminate when unreadable', () => {
    const facts = { days: { 'card-goal': ['2026-11-02'] }, milestones: {} };
    expect(line(evaluate(rs, facts), 'cards')).toMatchObject({ status: 'pending', note: '1 of 3 days' });
    expect(line(evaluate(rs, facts, { today: '2026-11-09' }), 'cards').status).toBe('none');
    expect(line(evaluate(rs, null), 'cards').status).toBe('indeterminate');
    expect(line(evaluate(rs, { days: {}, milestones: {}, unavailable: ['card-goal'] }), 'cards').status).toBe('indeterminate');
  });
});

describe('milestone', () => {
  const rs = ruleset([
    { id: 'levels', kind: 'milestone', match: { activity: 'board-game-level' }, reward: { gems: 1 }, effective: { from: '2026-11-03' } },
    { id: 'pb', kind: 'milestone', match: { activity: 'race-pb' }, cap: { count: 2 }, reward: { gems: 1 } },
  ]);
  const facts = {
    days: {},
    milestones: {
      'board-game-level': [
        { key: 'chess:4', day: '2026-11-02', label: 'Chess level 4' }, // before effective.from: never pays
        { key: 'chess:5', day: '2026-11-04', label: 'Chess level 5' },
        { key: 'chess:5', day: '2026-11-04', label: 'Chess level 5' }, // repeated key counts once
      ],
      'race-pb': [
        { key: 'c1', day: '2026-11-04', label: 'Hill' }, { key: 'c2', day: '2026-11-02', label: 'Flat' }, { key: 'c3', day: '2026-11-03', label: 'Loop' },
      ],
    },
  };
  it('pays one per new milestone, dated, deduplicated, inside effective', () => {
    expect(line(evaluate(rs, facts), 'levels')).toMatchObject({ status: 'earned', count: 1, amount: { gems: 1 } });
  });
  it('caps per week, oldest first, and says how many were over', () => {
    const l = line(evaluate(rs, facts), 'pb');
    expect(l).toMatchObject({ status: 'earned', count: 2, amount: { gems: 2 }, note: 'Weekly limit reached (1 more)' });
    expect(l.evidence.map((e) => [e.key, e.state])).toEqual([['c2', 'paid'], ['c3', 'paid'], ['c1', 'over-cap']]);
    expect(payoutMeta(l).items).toEqual(['Flat', 'Loop']);
  });
  it('none when nothing new', () => {
    expect(line(evaluate(rs, { days: {}, milestones: {} }), 'levels')).toMatchObject({ status: 'none', note: 'None this week' });
  });
});

describe('activity-contest', () => {
  const rs = ruleset([{ id: 'race', kind: 'activity-contest', match: { activity: 'race' }, reward: { gems: 1 } }]);
  const contests = (closed, standings) => ({ race: { closed, standings } });
  it('leads while open, wins once closed; zero never leads; unreadable is indeterminate', () => {
    const s = [{ learnerId: 'kid', score: 30 }, { learnerId: 'sib', score: 20 }];
    expect(line(evaluate(rs, null, { contests: contests(false, s) }), 'race')).toMatchObject({ status: 'pending', leader: true });
    expect(line(evaluate(rs, null, { contests: contests(true, s) }), 'race')).toMatchObject({ status: 'earned', amount: { gems: 1 } });
    expect(line(evaluate(rs, null, { contests: contests(true, [{ learnerId: 'kid', score: 0 }]) }), 'race')).toMatchObject({ status: 'none', leader: false });
    expect(line(evaluate(rs, null, { contests: null }), 'race').status).toBe('indeterminate');
  });
  it('shows on the board as a contest row: leading, then won', () => {
    const week = (closed) => ({
      windows: { school: WEEK }, learners: [{ ...evaluate(rs, null, { contests: contests(closed, [{ learnerId: 'kid', score: 5 }]) }), learnerName: 'Kid' }],
    });
    const open = buildGemBoard({ ruleset: rs, week: week(false) });
    expect(open.categories[0]).toMatchObject({ cadence: 'contest', color: '#ff7a2f' });
    expect(open.cells.race.kid.state).toBe('leading');
    expect(open.totals.kid.week).toBe(1);
    expect(buildGemBoard({ ruleset: rs, week: week(true) }).cells.race.kid).toMatchObject({ state: 'won', week: 1 });
  });
});
