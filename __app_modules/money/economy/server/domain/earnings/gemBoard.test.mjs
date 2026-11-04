// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings, buildGemBoard, gemCategories, lifetimeGemsByRule } from './index.mjs';
import { isPayoutEntry, paidRefOf } from '../index.mjs';

const WEEK = { from: '2026-11-02', to: '2026-11-08' };
const RINGS_WEEK = { from: '2026-11-02T12:00:00.000Z', to: '2026-11-07T20:00:00.000Z' };
const ruleset = (rules) => validateRuleset({ revision: 5, rules });

function evaluate(rs, facts = {}, extra = {}) {
  return evaluateEarnings({
    ruleset: rs, learnerId: 'kid',
    facts: { sectionDays: [], days: [], week: null, units: [], rings: null, ...facts },
    standings: null, contestClosed: false, windows: { school: WEEK, rings: RINGS_WEEK }, today: '2026-11-04', ...extra,
  });
}
const line = (out, id) => out.lines.find((l) => l.ruleId === id);
const ringDays = (list) => list.map(([day, rings]) => ({ day, rings }));

describe('ring-days rules', () => {
  const rs = ruleset([
    { id: 'moved', kind: 'ring-days', days: 3, reward: { gems: 1 } },
    { id: 'strong', kind: 'ring-days', days: 2, min: 100, reward: { gems: 1 } },
  ]);

  it('validates days 1–7 and a positive min, defaulting to 5 days of any rings', () => {
    expect(ruleset([{ id: 'x', kind: 'ring-days', reward: { gems: 1 } }]).rules[0]).toMatchObject({ days: 5, min: 1 });
    expect(() => ruleset([{ id: 'x', kind: 'ring-days', days: 8, reward: 1 }])).toThrow(/days/);
    expect(() => ruleset([{ id: 'x', kind: 'ring-days', min: 0, reward: 1 }])).toThrow(/min/);
  });

  it('earns once the count of moved days is reached, with progress', () => {
    const out = evaluate(rs, { rings: 260, ringDays: ringDays([['2026-11-02', 120], ['2026-11-03', 40], ['2026-11-04', 100]]) });
    expect(line(out, 'moved')).toMatchObject({ status: 'earned', count: 1, amount: { silver: 0, gems: 1 }, progress: { have: 3, need: 3 } });
    expect(line(out, 'strong')).toMatchObject({ status: 'earned', progress: { have: 2, need: 2 } });
    expect(line(out, 'strong').evidence.map((e) => e.state)).toEqual(['moved', 'short', 'moved']);
  });

  it('is pending while the award week runs and none once it closes short', () => {
    const facts = { rings: 50, ringDays: ringDays([['2026-11-02', 50]]) };
    expect(line(evaluate(rs, facts), 'moved')).toMatchObject({ status: 'pending', note: '1 of 3 days', progress: { have: 1, need: 3 } });
    expect(line(evaluate(rs, facts, { contestClosed: true }), 'moved')).toMatchObject({ status: 'none' });
  });

  it('is indeterminate when rings cannot be read', () => {
    expect(line(evaluate(rs, { rings: null, ringDays: null }), 'moved').status).toBe('indeterminate');
  });
});

describe('gem metadata', () => {
  it('normalizes a gem block and refuses a bad colour or category', () => {
    const rs = ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { category: 'school', label: ' School ', color: '#AABBCC' } }]);
    expect(rs.rules[0].gem).toEqual({ category: 'school', label: 'School', color: '#aabbcc' });
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { color: 'red' } }])).toThrow(/colour/);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { category: 'Not A Slug' } }])).toThrow(/category/);
  });

  it('rows are the rules that pay gems (or name a gem), grouped by category, in rule order', () => {
    const rs = ruleset([
      { id: 'green-day', kind: 'day-met', reward: 1 },
      { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
      { id: 'moved', kind: 'ring-days', days: 5, reward: { gems: 1 }, gem: { category: 'exercise', label: 'Exercise' } },
      { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
      { id: 'strong', kind: 'ring-days', days: 4, min: 100, reward: { gems: 1 }, gem: { category: 'exercise' } },
    ]);
    expect(gemCategories(rs)).toEqual([
      { id: 'green-week', label: 'green-week', cadence: 'weekly', color: '#d6304a', ruleIds: ['green-week'] },
      { id: 'exercise', label: 'Exercise', cadence: 'weekly', color: '#8e5bd0', ruleIds: ['moved', 'strong'] },
      { id: 'contest', label: 'contest', cadence: 'contest', color: '#1e88e5', ruleIds: ['contest'] },
    ]);
  });
});

describe('buildGemBoard', () => {
  const rs = ruleset([
    { id: 'green-week', label: 'Green week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
    { id: 'moved', label: 'Moved', kind: 'ring-days', days: 2, reward: { gems: 1 }, gem: { category: 'exercise' } },
    { id: 'strong', label: 'Strong', kind: 'ring-days', days: 2, min: 100, reward: { gems: 1 }, gem: { category: 'exercise' } },
    { id: 'contest', label: 'Most rings', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ]);
  const learner = (learnerId, facts, extra = {}) => ({
    ...evaluateEarnings({
      ruleset: rs, learnerId,
      facts: { sectionDays: [], days: [], week: null, units: [], ...facts },
      windows: { school: WEEK, rings: RINGS_WEEK }, today: '2026-11-04', ...extra,
    }),
    learnerName: learnerId.toUpperCase(),
  });
  const standings = [{ learnerId: 'a', rings: 300 }, { learnerId: 'b', rings: 40 }];
  const week = {
    windows: { school: WEEK, rings: RINGS_WEEK }, contestClosed: false, rulesRevision: 5, today: '2026-11-04',
    learners: [
      learner('a', { rings: 300, ringDays: ringDays([['2026-11-02', 150], ['2026-11-03', 150]]) }, { standings }),
      learner('b', { rings: 40, ringDays: ringDays([['2026-11-03', 40]]) }, { standings }),
    ],
  };

  it('lays out learners in roster order against every gem category', () => {
    const board = buildGemBoard({ ruleset: rs, week, lifetime: { a: { byRule: { 'green-week': 3, moved: 1 }, total: 7 } } });
    expect(board.learners).toEqual([{ learnerId: 'a', name: 'A' }, { learnerId: 'b', name: 'B' }]);
    expect(board.categories.map((c) => c.id)).toEqual(['green-week', 'exercise', 'contest']);
    expect(board.week).toBe('2026-11-02');
    // Two exercise rules in one row: both earned this week.
    expect(board.cells.exercise.a).toMatchObject({ state: 'earned', week: 2, lifetime: 2 });
    expect(board.cells.exercise.b).toMatchObject({ state: 'pending', week: 0, progress: { have: 1, need: 2 } });
    // The contest: a leads, not yet decided — no gem this week yet.
    expect(board.cells.contest.a).toMatchObject({ state: 'leading', week: 0 });
    expect(board.cells.contest.b.state).toBe('none');
    // School evidence missing (no week verdict) reads unknown, never missed.
    expect(board.cells['green-week'].a).toMatchObject({ state: 'unknown', lifetime: 3 });
    // a holds the contest gem while leading it: week counts it, earned does not.
    expect(board.totals.a).toEqual({ week: 3, earned: 2, lifetime: 7 });
    expect(board.totals.b).toEqual({ week: 0, earned: 0, lifetime: 0 });
  });

  it('a decided contest reads won', () => {
    const closed = { ...week, contestClosed: true, learners: [learner('a', { rings: 300, ringDays: [] }, { standings, contestClosed: true })] };
    expect(buildGemBoard({ ruleset: rs, week: closed }).cells.contest.a).toMatchObject({ state: 'won', week: 1 });
  });
});

describe('lifetimeGemsByRule', () => {
  const pay = (ref, ruleId, delta, currency = 'gems') => ({ kind: 'earn', source: 'payout', action: `payout:${ruleId}`, ref, ruleId, delta, currency });
  it('counts payout gems by rule, less reversals, ignoring silver and non-payout entries', () => {
    const list = [
      pay('earn:a:gw:2026-10-26:on-time:gems', 'gw', 1),
      pay('earn:a:gw:2026-11-02:on-time:gems', 'gw', 1),
      pay('earn:a:gw:2026-11-02:on-time', 'gw', 5, 'silver'),
      { kind: 'adjust', ref: 'reverse:earn:a:gw:2026-11-02:on-time:gems', delta: -1, currency: 'gems' },
      { kind: 'adjust', ref: 'manual', delta: 4, currency: 'gems' },
    ];
    expect(lifetimeGemsByRule(list, { isPayoutEntry, paidRefOf })).toEqual({ gw: 1 });
  });
});
