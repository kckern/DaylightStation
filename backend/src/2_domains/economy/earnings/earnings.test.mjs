import { describe, it, expect } from 'vitest';
import {
  RULE_KINDS, DEFAULT_RULESET, validateRuleset, resolveRules, withUserOverride, evaluateEarnings, earningRef,
} from './index.mjs';

const WEEK = { from: '2026-09-21', to: '2026-09-27' };
const RINGS_WEEK = { from: '2026-09-21T11:00:00.000Z', to: '2026-09-26T19:00:00.000Z' };
const days = (list) => list.map(([day, state, reason = null]) => ({ day, state, reason, timeliness: 'on-time' }));
const sections = (subject, list) => list.map(([day, state, reason = null]) => ({ day, subject, state, reason, timeliness: 'on-time' }));

const ruleset = (rules, users = {}) => validateRuleset({ revision: 4, currency: 'silver', rules, users });

function evaluate(rs, facts = {}, extra = {}) {
  return evaluateEarnings({
    ruleset: rs, learnerId: 'kid',
    facts: { sectionDays: [], days: [], week: null, units: [], rings: null, ...facts },
    standings: null, contestClosed: false, windows: { school: WEEK, rings: RINGS_WEEK }, ...extra,
  });
}
const line = (out, id) => out.lines.find((l) => l.ruleId === id);

describe('validateRuleset', () => {
  it('knows seven kinds, one per earning trigger', () => {
    expect(RULE_KINDS).toEqual(['unit', 'section-day', 'section-week', 'day-met', 'week-met', 'ring-threshold', 'ring-contest']);
  });

  it('normalizes a bare number reward to silver and fills defaults', () => {
    const rs = ruleset([{ id: 'green-day', kind: 'day-met', reward: 2 }]);
    expect(rs.rules[0]).toMatchObject({ id: 'green-day', label: 'green-day', reward: { silver: 2, gems: 0 }, match: {} });
    expect(rs).toMatchObject({ revision: 4, currency: 'silver', users: {} });
  });

  it('refuses an unknown kind, a duplicate id, a negative reward, and a section rule with no subject', () => {
    expect(() => ruleset([{ id: 'x', kind: 'bonus', reward: 1 }])).toThrow(/kind/);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1 }, { id: 'x', kind: 'week-met', reward: 1 }])).toThrow(/duplicate/);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: -1 }])).toThrow(/reward/);
    expect(() => ruleset([{ id: 'x', kind: 'section-day', reward: 1 }])).toThrow(/subject/);
  });

  it('refuses a user override for a rule that does not exist, and a bad multiplier', () => {
    const rules = [{ id: 'green-day', kind: 'day-met', reward: 1 }];
    expect(() => ruleset(rules, { kid: { rules: { nope: { reward: 1 } } } })).toThrow(/nope/);
    expect(() => ruleset(rules, { kid: { multiplier: 0 } })).toThrow(/multiplier/);
    expect(() => ruleset(rules, { kid: { multiplier: 11 } })).toThrow(/multiplier/);
  });

  it('sorts ring thresholds and refuses a non-positive one', () => {
    const rs = ruleset([{ id: 'rings', kind: 'ring-threshold', rate: { rings: 1, silver: 1 }, thresholds: [{ at: 40, reward: 10 }, { at: 20, reward: 5 }] }]);
    expect(rs.rules[0].thresholds.map((t) => t.at)).toEqual([20, 40]);
    expect(() => ruleset([{ id: 'rings', kind: 'ring-threshold', thresholds: [{ at: 0, reward: 1 }] }])).toThrow(/threshold/);
  });

  it('ships a default ruleset that validates', () => {
    const rs = validateRuleset(DEFAULT_RULESET);
    expect(rs.rules.map((r) => r.kind)).toEqual(expect.arrayContaining(['section-day', 'section-week', 'day-met', 'week-met', 'ring-threshold', 'ring-contest']));
  });
});

describe('resolveRules — per-learner overrides, most specific wins', () => {
  const rs = ruleset([
    { id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 },
    { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ], { little: { multiplier: 2, rules: { korean: { reward: 3 }, contest: { disabled: true } } } });

  it('a learner with no overrides gets the household rules at ×1', () => {
    expect(resolveRules(rs, 'big').map((r) => [r.id, r.reward.silver, r.multiplier, r.disabled])).toEqual([
      ['korean', 2, 1, false], ['contest', 5, 1, false],
    ]);
  });
  it('an override replaces the reward, sets the multiplier and can disable a rule', () => {
    expect(resolveRules(rs, 'little').map((r) => [r.id, r.reward.silver, r.multiplier, r.disabled])).toEqual([
      ['korean', 3, 2, false], ['contest', 5, 2, true],
    ]);
  });
});

describe('withUserOverride — one learner\'s rates, returned as a new validated ruleset', () => {
  const base = ruleset([{ id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 }]);

  it('sets a reward and a multiplier without touching the household rule', () => {
    const next = withUserOverride(base, 'little', { multiplier: 2, rules: { korean: { reward: 3 } } });
    expect(next.users.little).toEqual({ multiplier: 2, rules: { korean: { reward: { silver: 3, gems: 0 } } } });
    expect(next.rules[0].reward).toEqual({ silver: 2, gems: 0 });
    expect(base.users).toEqual({});
  });

  it('null clears a rule override; multiplier 1 clears the multiplier; an empty learner disappears', () => {
    const set = withUserOverride(base, 'little', { multiplier: 2, rules: { korean: { reward: 3 } } });
    const cleared = withUserOverride(set, 'little', { multiplier: 1, rules: { korean: null } });
    expect(cleared.users).toEqual({});
  });

  it('refuses a bad value through the same validation', () => {
    expect(() => withUserOverride(base, 'little', { rules: { korean: { reward: -1 } } })).toThrow(/reward/);
    expect(() => withUserOverride(base, 'little', { rules: { nope: { reward: 1 } } })).toThrow(/nope/);
    expect(() => withUserOverride(base, '', {})).toThrow(/learnerId/);
  });
});

describe('evaluateEarnings — school kinds', () => {
  it('section-day pays each day the subject was served, whatever else happened ("no matter what")', () => {
    const rs = ruleset([{ id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 }]);
    const out = evaluate(rs, { sectionDays: [
      ...sections('language', [['2026-09-21', 'served'], ['2026-09-22', 'obligated'], ['2026-09-26', 'served']]),
      ...sections('math', [['2026-09-21', 'served']]),
    ] });
    expect(line(out, 'korean')).toMatchObject({ status: 'earned', count: 2, amount: { silver: 4, gems: 0 } });
    expect(line(out, 'korean').evidence.map((e) => e.day)).toEqual(['2026-09-21', '2026-09-22', '2026-09-26']);
    expect(out.totals).toEqual({ silver: 4, gems: 0 });
  });

  it('section-week pays once when every obligated day was served (weekly_satisfied counts), nothing when one was missed', () => {
    const rs = ruleset([{ id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 }]);
    const done = evaluate(rs, { week: { weekId: WEEK.from, state: 'met', open: false }, sectionDays: sections('scripture', [
      ['2026-09-21', 'served'], ['2026-09-22', 'excused', 'weekly_satisfied'], ['2026-09-23', 'served'], ['2026-09-26', 'excused', 'not_a_school_day'],
    ]) });
    expect(line(done, 'scripture')).toMatchObject({ status: 'earned', count: 1, amount: { silver: 5, gems: 0 } });
    const missed = evaluate(rs, { week: { weekId: WEEK.from, state: 'partial', open: false }, sectionDays: sections('scripture', [
      ['2026-09-21', 'served'], ['2026-09-22', 'obligated'],
    ]) });
    expect(line(missed, 'scripture')).toMatchObject({ status: 'none', amount: { silver: 0, gems: 0 } });
    expect(line(missed, 'scripture').note).toMatch(/2026-09-22/);
  });

  it('section-week is pending, not lost, while the week is still open', () => {
    const rs = ruleset([{ id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 }]);
    const out = evaluate(rs, { week: { weekId: WEEK.from, state: 'partial', open: true }, sectionDays: sections('scripture', [['2026-09-21', 'served'], ['2026-09-22', 'obligated']]) });
    expect(line(out, 'scripture').status).toBe('pending');
    // Saturday morning, the teacher needs to see WHICH day is missing, not just "still going".
    expect(line(out, 'scripture').note).toMatch(/2026-09-22/);
  });

  it('a week where the subject was never served pays nothing', () => {
    const rs = ruleset([{ id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 }]);
    const out = evaluate(rs, { week: { weekId: WEEK.from, state: 'exempt', open: false }, sectionDays: sections('scripture', [['2026-09-26', 'excused', 'not_a_school_day']]) });
    expect(line(out, 'scripture').status).toBe('none');
  });

  it('a faulted day makes an otherwise-empty line indeterminate, never a silent zero', () => {
    const rs = ruleset([{ id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 }]);
    const out = evaluate(rs, { sectionDays: sections('language', [['2026-09-21', 'faulted', 'program_unavailable']]) });
    expect(line(out, 'korean')).toMatchObject({ status: 'indeterminate', amount: { silver: 0, gems: 0 } });
  });

  it('day-met pays each green day; week-met pays silver and a gem', () => {
    const rs = ruleset([
      { id: 'green-day', kind: 'day-met', reward: 1 },
      { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
    ]);
    const out = evaluate(rs, {
      days: days([['2026-09-21', 'met'], ['2026-09-22', 'met'], ['2026-09-23', 'met'], ['2026-09-24', 'met'], ['2026-09-25', 'met'], ['2026-09-26', 'exempt']]),
      week: { weekId: WEEK.from, state: 'met', open: false },
    });
    expect(line(out, 'green-day')).toMatchObject({ status: 'earned', count: 5, amount: { silver: 5, gems: 0 } });
    expect(line(out, 'green-week')).toMatchObject({ status: 'earned', count: 1, amount: { silver: 5, gems: 1 } });
    expect(out.totals).toEqual({ silver: 10, gems: 1 });
  });

  // 2026-09-26, on real data: the term grid's WEEK ROW covers weekly-cadence
  // work only — a learner with none reads `exempt / no_weekly_work` even when
  // every day was green. A green week is every study day green AND the
  // weekly row satisfied (taxonomy §5), so week-met folds the days itself.
  it('week-met is every study day green plus a satisfied weekly row — paid Saturday, not held to Sunday', () => {
    const rs = ruleset([{ id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } }]);
    const allGreen = days([['2026-09-21', 'met'], ['2026-09-22', 'met'], ['2026-09-23', 'met'], ['2026-09-24', 'met'], ['2026-09-25', 'met'], ['2026-09-26', 'exempt', 'not_a_school_day']]);
    const saturday = evaluate(rs, { days: allGreen, week: { weekId: WEEK.from, state: 'exempt', reason: 'no_weekly_work', open: true } });
    expect(line(saturday, 'green-week')).toMatchObject({ status: 'earned', amount: { silver: 5, gems: 1 } });
    // An unfinished weekly-cadence unit still blocks it.
    const weeklyOpen = evaluate(rs, { days: allGreen, week: { weekId: WEEK.from, state: 'partial', open: false } });
    expect(line(weeklyOpen, 'green-week').status).toBe('none');
  });

  it('week-met: a day that was not green means no green week, and the note names it', () => {
    const rs = ruleset([{ id: 'green-week', kind: 'week-met', reward: 5 }]);
    const out = evaluate(rs, {
      days: days([['2026-09-21', 'partial'], ['2026-09-22', 'met'], ['2026-09-23', 'met'], ['2026-09-24', 'partial'], ['2026-09-25', 'met'], ['2026-09-26', 'met']]),
      week: { weekId: WEEK.from, state: 'exempt', reason: 'no_weekly_work', open: true },
    });
    expect(line(out, 'green-week')).toMatchObject({ status: 'none' });
    expect(line(out, 'green-week').note).toMatch(/2026-09-21.*2026-09-24/);
  });

  it('a week cannot pay before its Friday: all-green-so-far on a Wednesday is pending', () => {
    const rs = ruleset([
      { id: 'green-week', kind: 'week-met', reward: 5 },
      { id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 },
    ]);
    const out = evaluate(rs, {
      days: days([['2026-09-21', 'met'], ['2026-09-22', 'met'], ['2026-09-23', 'met']]),
      sectionDays: sections('scripture', [['2026-09-21', 'served'], ['2026-09-22', 'served'], ['2026-09-23', 'served']]),
      week: { weekId: WEEK.from, state: 'exempt', reason: 'no_weekly_work', open: true },
    });
    expect(line(out, 'green-week').status).toBe('pending');
    expect(line(out, 'scripture').status).toBe('pending');
  });

  it('week-met is pending while the week is open and indeterminate when the week is unknown', () => {
    const rs = ruleset([{ id: 'green-week', kind: 'week-met', reward: 5 }]);
    expect(line(evaluate(rs, { days: days([['2026-09-21', 'met']]), week: { weekId: WEEK.from, state: 'partial', open: true } }), 'green-week').status).toBe('pending');
    expect(line(evaluate(rs, { days: days([['2026-09-21', 'met']]), week: { weekId: WEEK.from, state: 'unknown', open: false } }), 'green-week').status).toBe('indeterminate');
    expect(line(evaluate(rs, { days: days([['2026-09-21', 'unknown', 'pending']]), week: { weekId: WEEK.from, state: 'exempt', open: false } }), 'green-week').status).toBe('indeterminate');
    expect(line(evaluate(rs, { week: null }), 'green-week').status).toBe('indeterminate');
  });

  it('unit pays each served unit matching the selector (subject, course, unit prefix)', () => {
    const rs = ruleset([{ id: 'math-units', kind: 'unit', match: { courseId: 'elementary-math-2-3' }, reward: 1 }]);
    const out = evaluate(rs, { units: [
      { day: '2026-09-21', unitId: 'em23-03-01', subject: 'math', courseId: 'elementary-math-2-3' },
      { day: '2026-09-22', unitId: 'em23-03-02', subject: 'math', courseId: 'elementary-math-2-3' },
      { day: '2026-09-22', unitId: 'atlas-1', subject: 'civilization', courseId: 'young-peoples-atlas-us' },
    ] });
    expect(line(out, 'math-units')).toMatchObject({ status: 'earned', count: 2, amount: { silver: 2, gems: 0 } });
  });

  it('when School evidence is unavailable, every school line is indeterminate — never "not done"', () => {
    const rs = ruleset([
      { id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 },
      { id: 'green-day', kind: 'day-met', reward: 1 },
      { id: 'units', kind: 'unit', reward: 1 },
    ]);
    const out = evaluate(rs, {}, { unavailable: { school: true } });
    expect(out.lines.map((l) => [l.ruleId, l.status])).toEqual([['korean', 'indeterminate'], ['green-day', 'indeterminate'], ['units', 'indeterminate']]);
    expect(line(out, 'korean').note).toMatch(/School/);
  });

  it('effective dates scope a rule; outside them it is not listed', () => {
    const rs = ruleset([{ id: 'green-day', kind: 'day-met', reward: 1, effective: { from: '2026-09-23' } }]);
    const out = evaluate(rs, { days: days([['2026-09-21', 'met'], ['2026-09-23', 'met']]) });
    expect(line(out, 'green-day').count).toBe(1);
    const later = ruleset([{ id: 'green-day', kind: 'day-met', reward: 1, effective: { from: '2026-10-01' } }]);
    expect(evaluate(later, { days: days([['2026-09-21', 'met']]) }).lines).toEqual([]);
  });
});

describe('evaluateEarnings — rings', () => {
  const rings = ruleset([
    { id: 'rings', kind: 'ring-threshold', rate: { rings: 1, silver: 1 }, thresholds: [{ at: 20, reward: 5 }, { at: 40, reward: { silver: 10, gems: 1 } }] },
    { id: 'contest', kind: 'ring-contest', tie: 'all', reward: { silver: 5, gems: 1 } },
  ]);

  it('ring-threshold pays per ring plus each threshold crossed, and names the next one', () => {
    const out = evaluate(rings, { rings: 23 });
    expect(line(out, 'rings')).toMatchObject({ status: 'earned', count: 23, amount: { silver: 28, gems: 0 } });
    expect(line(out, 'rings').note).toMatch(/17 more to 40/);
  });

  it('the rate is a ratio: 1 silver per 100 rings pays whole hundreds only', () => {
    const rs = ruleset([{ id: 'rings', kind: 'ring-threshold', rate: { rings: 100, silver: 1 }, thresholds: [] }]);
    expect(line(evaluate(rs, { rings: 1462 }), 'rings')).toMatchObject({ status: 'earned', amount: { silver: 14, gems: 0 } });
    expect(line(evaluate(rs, { rings: 99 }), 'rings')).toMatchObject({ status: 'none', amount: { silver: 0, gems: 0 } });
  });

  it('refuses a ratio with zero rings', () => {
    expect(() => ruleset([{ id: 'rings', kind: 'ring-threshold', rate: { rings: 0, silver: 1 } }])).toThrow(/rate/);
  });

  it('rings unavailable → indeterminate', () => {
    expect(line(evaluate(rings, { rings: null }), 'rings').status).toBe('indeterminate');
  });

  it('the contest is pending with a leader mark before Saturday noon, and pays the leader after', () => {
    const standings = [{ learnerId: 'kid', rings: 23 }, { learnerId: 'sib', rings: 11 }];
    const open = evaluate(rings, { rings: 23 }, { standings });
    expect(line(open, 'contest')).toMatchObject({ status: 'pending', leader: true, amount: { silver: 5, gems: 1 } });
    expect(open.totals).toEqual({ silver: 28, gems: 0 });
    expect(open.pending).toEqual({ silver: 5, gems: 1 });
    const closed = evaluate(rings, { rings: 23 }, { standings, contestClosed: true });
    expect(line(closed, 'contest')).toMatchObject({ status: 'earned', leader: true });
    expect(closed.totals).toEqual({ silver: 33, gems: 1 });
  });

  it('never ranks: a non-leader gets none and the line names no position', () => {
    const out = evaluate(rings, { rings: 11 }, { standings: [{ learnerId: 'kid', rings: 11 }, { learnerId: 'sib', rings: 23 }], contestClosed: true });
    expect(line(out, 'contest')).toMatchObject({ status: 'none', leader: false });
    expect(JSON.stringify(line(out, 'contest'))).not.toMatch(/rank|place|position|second|last/i);
  });

  it('a tie follows the rule: all winners, split, or nobody', () => {
    const standings = [{ learnerId: 'kid', rings: 20 }, { learnerId: 'sib', rings: 20 }];
    const tie = (t) => ruleset([{ id: 'contest', kind: 'ring-contest', tie: t, reward: { silver: 6, gems: 1 } }]);
    expect(line(evaluate(tie('all'), { rings: 20 }, { standings, contestClosed: true }), 'contest').amount).toEqual({ silver: 6, gems: 1 });
    expect(line(evaluate(tie('split'), { rings: 20 }, { standings, contestClosed: true }), 'contest').amount).toEqual({ silver: 3, gems: 0 });
    expect(line(evaluate(tie('none'), { rings: 20 }, { standings, contestClosed: true }), 'contest').status).toBe('none');
  });

  it('nobody leads a week with no rings', () => {
    const out = evaluate(rings, { rings: 0 }, { standings: [{ learnerId: 'kid', rings: 0 }, { learnerId: 'sib', rings: 0 }], contestClosed: true });
    expect(line(out, 'contest')).toMatchObject({ status: 'none', leader: false });
  });
});

describe('evaluateEarnings — per-learner pricing and refs', () => {
  const rs = ruleset([
    { id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 },
    { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ], { kid: { multiplier: 1.5, rules: { korean: { reward: 3 }, contest: { disabled: true } } } });

  it('the multiplier scales silver (rounded), never gems; a disabled rule is listed as disabled and pays nothing', () => {
    const out = evaluate(rs, { sectionDays: sections('language', [['2026-09-21', 'served']]) });
    expect(line(out, 'korean')).toMatchObject({ amount: { silver: 5, gems: 0 }, priced: { revision: 4, reward: { silver: 3, gems: 0 }, multiplier: 1.5 } });
    expect(line(out, 'contest')).toMatchObject({ status: 'disabled', amount: { silver: 0, gems: 0 } });
  });

  it('the ref is learner + rule + period + timeliness — never the revision, so a rate edit cannot pay a week twice', () => {
    const out = evaluate(rs, { sectionDays: sections('language', [['2026-09-21', 'served']]) });
    expect(line(out, 'korean').ref).toBe(earningRef({ learnerId: 'kid', ruleId: 'korean', period: WEEK.from }));
    expect(line(out, 'korean').ref).toBe('earn:kid:korean:2026-09-21:on-time');
    expect(line(out, 'korean').evidence[0].ref).toBe('earn:kid:korean:2026-09-21:on-time');
    const bumped = evaluate({ ...rs, revision: 9 }, { sectionDays: sections('language', [['2026-09-21', 'served']]) });
    expect(line(bumped, 'korean').ref).toBe(line(out, 'korean').ref);
    expect(out.rulesRevision).toBe(4);
  });

  it('echoes both windows and the currency', () => {
    const out = evaluate(rs, {});
    expect(out).toMatchObject({ learnerId: 'kid', currency: 'silver', windows: { school: WEEK, rings: RINGS_WEEK } });
  });
});
