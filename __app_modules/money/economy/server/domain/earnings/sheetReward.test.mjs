import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings, sheetReward } from "./index.mjs";

// Monday 2026-09-21 → Sunday 2026-09-27.
const WEEK = { from: '2026-09-21', to: '2026-09-27' };
const RINGS_WEEK = { from: '2026-09-21T11:00:00.000Z', to: '2026-09-26T19:00:00.000Z' };
const WEDNESDAY = '2026-09-23';
const FRIDAY = '2026-09-25';

const days = (list) => list.map(([day, state]) => ({ day, state, reason: null, timeliness: 'on-time' }));
const sections = (subject, list) => list.map(([day, state]) => ({ day, subject, state, reason: null, timeliness: 'on-time' }));
const ruleset = (rules, users = {}) => validateRuleset({ revision: 1, currency: 'silver', rules, users });

/** A week as the preview prices it: the real evaluator, plus the preview's own fields. */
function week(rs, facts = {}, { today = WEDNESDAY, school = 'ok', unavailable = {} } = {}) {
  const f = { sectionDays: [], days: [], week: null, units: [], rings: 300, ...facts };
  return {
    ...evaluateEarnings({
      ruleset: rs, learnerId: 'kid', facts: f, standings: [{ learnerId: 'kid', rings: 300 }],
      contestClosed: false, windows: { school: WEEK, rings: RINGS_WEEK }, today, unavailable,
    }),
    today,
    evidence: { school, rings: 'ok' },
    work: { days: f.days, sectionDays: f.sectionDays, week: f.week, units: f.units, rings: f.rings },
  };
}

const KOREAN = { id: 'korean-daily', kind: 'section-day', match: { subject: 'language' }, reward: { silver: 2 } };
const LANGUAGE_UNIT = { unitId: 'language.07', title: 'Korean 7', subject: 'language' };
const todayOpen = (subject = 'language', state = 'obligated') => ({
  days: days([['2026-09-21', 'met'], ['2026-09-22', 'met'], [WEDNESDAY, 'partial']]),
  sectionDays: sections(subject, [['2026-09-21', 'served'], ['2026-09-22', 'served'], [WEDNESDAY, state]]),
});

describe('sheetReward', () => {
  it('section-day not yet earned today: that rule\'s amount for one day', () => {
    const w = week(ruleset([KOREAN]), todayOpen());
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 2, gems: 0 });
  });

  it('section-day already earned today: null, another sheet adds nothing', () => {
    const w = week(ruleset([KOREAN]), todayOpen('language', 'served'));
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('section-day: an elective, a faulted day or no row today is null', () => {
    const rs = ruleset([KOREAN]);
    expect(sheetReward({ week: week(rs, todayOpen('language', 'excused')), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    expect(sheetReward({ week: week(rs, todayOpen('language', 'faulted')), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    const noRowToday = { days: days([['2026-09-21', 'met']]), sectionDays: sections('language', [['2026-09-21', 'served']]) };
    expect(sheetReward({ week: week(rs, noRowToday), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('carries gems, and the learner\'s multiplier, as the payout would price one more day', () => {
    const rs = ruleset([{ ...KOREAN, reward: { silver: 3, gems: 1 } }], { kid: { multiplier: 1.5 } });
    // Two days served: round(13.5) − round(9) = 14 − 9 = 5.
    expect(sheetReward({ week: week(rs, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 5, gems: 1 });
  });

  it('green day, green week and rings are never attributed to a sheet', () => {
    const rs = ruleset([
      { id: 'green-day', kind: 'day-met', reward: { silver: 1 } },
      { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
      { id: 'rings', kind: 'ring-threshold', rate: { rings: 100, silver: 1 }, thresholds: [{ at: 250, reward: 2 }] },
      { id: 'ring-contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
    ]);
    const w = week(rs, todayOpen());
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    // ...and they do not make a priced subject ambiguous either.
    const both = week(ruleset([KOREAN, { id: 'green-day', kind: 'day-met', reward: { silver: 1 } }]), todayOpen());
    expect(sheetReward({ week: both, unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 2, gems: 0 });
  });

  it('a subject no rule prices is null', () => {
    const w = week(ruleset([KOREAN]), todayOpen('math'));
    expect(sheetReward({ week: w, unit: { unitId: 'math.4-02', title: 'Math 4-02', subject: 'math' }, mode: 'live' })).toBeNull();
  });

  it('ambiguity is null: two rules for one subject, an unknown subject or course', () => {
    const two = ruleset([KOREAN, { id: 'korean-unit', kind: 'unit', match: { subject: 'language' }, reward: { silver: 1 } }]);
    expect(sheetReward({ week: week(two, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    expect(sheetReward({ week: week(ruleset([KOREAN]), todayOpen()), unit: { unitId: 'x', subject: null }, mode: 'live' })).toBeNull();
    const byCourse = ruleset([{ id: 'course-unit', kind: 'unit', match: { courseId: 'korean-1' }, reward: { silver: 1 } }]);
    expect(sheetReward({ week: week(byCourse, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('a learner override: the overridden price, as the payout prices it', () => {
    const overridden = ruleset([KOREAN], { kid: { rules: { 'korean-daily': { reward: { silver: 4 } } } } });
    expect(sheetReward({ week: week(overridden, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 4, gems: 0 });
  });

  it('a fractional multiplier: what the rounded week TOTAL gains, not one rounded day', () => {
    const oneServed = {
      days: days([['2026-09-22', 'met'], [WEDNESDAY, 'partial']]),
      sectionDays: sections('language', [['2026-09-22', 'served'], [WEDNESDAY, 'obligated']]),
    };
    const s1 = ruleset([{ ...KOREAN, reward: { silver: 1 } }], { kid: { multiplier: 1.5 } });
    // round(1.5) = 2 paid; round(3) = 3 → this sheet adds 1, not round(1.5) = 2.
    expect(sheetReward({ week: week(s1, oneServed), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 1, gems: 0 });
    // 0.5: round(0.5) = 1 paid; round(1.0) = 1 → adds nothing: null, never "+0".
    const half = ruleset([{ ...KOREAN, reward: { silver: 1 } }], { kid: { multiplier: 0.5 } });
    expect(sheetReward({ week: week(half, oneServed), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    // 0.5 with nothing served yet: round(0.5) = 1 → +1.
    const noneServed = { days: days([[WEDNESDAY, 'partial']]), sectionDays: sections('language', [[WEDNESDAY, 'obligated']]) };
    expect(sheetReward({ week: week(half, noneServed), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 1, gems: 0 });
    // Gems ride along even when the silver diff is 0.
    const gems = ruleset([{ ...KOREAN, reward: { silver: 1, gems: 1 } }], { kid: { multiplier: 0.5 } });
    expect(sheetReward({ week: week(gems, oneServed), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 0, gems: 1 });
  });

  it('a unit rule outside its effective dates today is null', () => {
    const unit = { unitId: 'math.4-02', subject: 'math' };
    const ended = ruleset([{ id: 'math-sheets', kind: 'unit', match: { subject: 'math' }, reward: 1, effective: { to: '2026-09-22' } }]);
    expect(sheetReward({ week: week(ended, todayOpen('math')), unit, mode: 'live' })).toBeNull();
    const notYet = ruleset([{ id: 'math-sheets', kind: 'unit', match: { subject: 'math' }, reward: 1, effective: { from: '2026-09-24' } }]);
    expect(sheetReward({ week: week(notYet, todayOpen('math')), unit, mode: 'live' })).toBeNull();
    const now = ruleset([{ id: 'math-sheets', kind: 'unit', match: { subject: 'math' }, reward: 1, effective: { from: '2026-09-23', to: '2026-09-23' } }]);
    expect(sheetReward({ week: week(now, todayOpen('math')), unit, mode: 'live' })).toEqual({ silver: 1, gems: 0 });
  });

  it('section rules match on subject only, as the evaluator does', () => {
    const byCourse = ruleset([{ ...KOREAN, match: { subject: 'language', courseId: 'korean-1' } }]);
    expect(sheetReward({ week: week(byCourse, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 2, gems: 0 });
    // A section rule's unitId is ignored too: with a unit rule beside it, two candidates.
    const two = ruleset([
      { ...KOREAN, match: { subject: 'language', unitId: 'other.' } },
      { id: 'korean-unit', kind: 'unit', match: { subject: 'language' }, reward: 1 },
    ]);
    expect(sheetReward({ week: week(two, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('a unit marked elective is null: the amount assumes required work, passed', () => {
    const w = week(ruleset([KOREAN]), todayOpen());
    expect(sheetReward({ week: w, unit: { ...LANGUAGE_UNIT, elective: true }, mode: 'live' })).toBeNull();
  });

  it('a rule switched off for this learner is not a match', () => {
    const rs = ruleset([KOREAN, { id: 'korean-unit', kind: 'unit', match: { subject: 'language' }, reward: { silver: 1 } }],
      { kid: { rules: { 'korean-unit': { disabled: true } } } });
    expect(sheetReward({ week: week(rs, todayOpen()), unit: LANGUAGE_UNIT, mode: 'live' })).toEqual({ silver: 2, gems: 0 });
  });

  it('a unit rule: its per-unit price, matched by subject and unit id', () => {
    const rs = ruleset([{ id: 'math-sheets', kind: 'unit', match: { subject: 'math', unitId: 'math.4' }, reward: { silver: 1, gems: 1 } }]);
    const w = week(rs, todayOpen('math'));
    expect(sheetReward({ week: w, unit: { unitId: 'math.4-02', subject: 'math' }, mode: 'live' })).toEqual({ silver: 1, gems: 1 });
    expect(sheetReward({ week: w, unit: { unitId: 'math.5-01', subject: 'math' }, mode: 'live' })).toBeNull();
  });

  it('section-week: only when this sheet finishes the week', () => {
    const rs = ruleset([{ id: 'scripture-week', kind: 'section-week', match: { subject: 'scripture' }, reward: { silver: 5 } }]);
    const unit = { unitId: 'scripture.12', subject: 'scripture' };
    const through = (today, todayState, before = 'served') => {
      const list = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].filter((d) => d <= today);
      const rows = list.map((d) => [d, d === today ? todayState : before]);
      return week(rs, { days: days(rows.map(([d]) => [d, 'met'])), sectionDays: sections('scripture', rows) }, { today });
    };
    // Friday, every earlier day served, today still to do: this sheet finishes it.
    expect(sheetReward({ week: through(FRIDAY, 'obligated'), unit, mode: 'live' })).toEqual({ silver: 5, gems: 0 });
    // Midweek: later days are still to come, so it is unclear.
    expect(sheetReward({ week: through(WEDNESDAY, 'obligated'), unit, mode: 'live' })).toBeNull();
    // A day already missed: the week cannot be earned.
    expect(sheetReward({ week: through(FRIDAY, 'obligated', 'obligated'), unit, mode: 'live' })).toBeNull();
    // Today already done: nothing left for a sheet to finish.
    expect(sheetReward({ week: through(FRIDAY, 'served'), unit, mode: 'live' })).toBeNull();
    // Saturday with a Saturday obligation still open: this sheet finishes it.
    const SATURDAY = '2026-09-26';
    const sat = (satState) => {
      const rows = [['2026-09-21', 'served'], ['2026-09-22', 'served'], ['2026-09-25', 'served'], [SATURDAY, satState]];
      return week(rs, { days: days(rows.map(([d]) => [d, 'met'])), sectionDays: sections('scripture', rows) }, { today: SATURDAY });
    };
    expect(sat('obligated').lines[0].status).toBe('pending');
    expect(sheetReward({ week: sat('obligated'), unit, mode: 'live' })).toEqual({ silver: 5, gems: 0 });
    // Saturday with everything served: the line is earned, not pending — nothing to add.
    expect(sat('served').lines[0].status).toBe('earned');
    expect(sheetReward({ week: sat('served'), unit, mode: 'live' })).toBeNull();
    // Not pending (a faulted day makes it indeterminate): null even on Friday.
    const faulted = week(rs, {
      days: days([['2026-09-24', 'met'], [FRIDAY, 'partial']]),
      sectionDays: sections('scripture', [['2026-09-24', 'faulted'], [FRIDAY, 'obligated']]),
    }, { today: FRIDAY });
    expect(faulted.lines[0].status).toBe('indeterminate');
    expect(sheetReward({ week: faulted, unit, mode: 'live' })).toBeNull();
  });

  it('school evidence unavailable or outside the term: null', () => {
    const rs = ruleset([KOREAN]);
    const down = week(rs, {}, { school: 'unavailable', unavailable: { school: true } });
    expect(sheetReward({ week: down, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
    const outside = week(rs, {}, { school: 'outside-term', unavailable: { school: 'outside-term' } });
    expect(sheetReward({ week: outside, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('only a live economy shows an amount: off and dry-run are null', () => {
    const w = week(ruleset([KOREAN]), todayOpen());
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'off' })).toBeNull();
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'dry-run' })).toBeNull();
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT })).toBeNull();
    expect(sheetReward({ week: null, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });

  it('a rule priced at nothing is null, never "+0"', () => {
    const w = week(ruleset([{ ...KOREAN, reward: 0 }]), todayOpen());
    expect(sheetReward({ week: w, unit: LANGUAGE_UNIT, mode: 'live' })).toBeNull();
  });
});
