import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings } from "./index.mjs";

// Mon 2026-11-09 … Sun 2026-11-15.
const WEEK = { from: '2026-11-09', to: '2026-11-15' };
const ruleset = (rules) => validateRuleset({ revision: 4, currency: 'silver', rules, users: {} });
const day = (d, state, extra = {}) => ({ day: d, state, reason: null, timeliness: 'on-time', ...extra });
const weekday = (d, state) => day(d, state, { greenWeek: true });
const weekend = (d, state) => day(d, state, { greenWeek: false });
const sec = (d, state, reason = null) => ({ day: d, subject: 'scripture', state, reason, timeliness: 'on-time' });
const openWeek = { weekId: WEEK.from, state: 'exempt', reason: 'no_weekly_work', open: true };

function evaluate(rs, facts, today) {
  return evaluateEarnings({
    ruleset: rs, learnerId: 'kid',
    facts: { sectionDays: [], days: [], week: openWeek, units: [], rings: null, ...facts },
    standings: null, contestClosed: false, windows: { school: WEEK }, today,
  });
}
const line = (out, id) => out.lines.find((l) => l.ruleId === id);
const greenWeek = ruleset([{ id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } }]);
const scriptureWeek = ruleset([{ id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 }]);
const fiveGreen = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => weekday(d, 'met'));

describe('Green Week — weekdays only, tier days drop out', () => {
  it('a missed Saturday scripture does not cost the gem', () => {
    const out = evaluate(greenWeek, { days: [...fiveGreen, weekend('2026-11-14', 'none')] }, '2026-11-15');
    expect(line(out, 'green-week')).toMatchObject({ status: 'earned', progress: { have: 5, need: 5 } });
    // The gem board's day strip is drawn from this evidence: no weekend in it.
    expect(line(out, 'green-week').evidence.filter((e) => e.day).map((e) => e.day)).not.toContain('2026-11-14');
  });

  it('a stay-home Wednesday drops out of the count', () => {
    const days = fiveGreen.map((d) => (d.day === '2026-11-11' ? day('2026-11-11', 'none', { greenWeek: false }) : d));
    const out = evaluate(greenWeek, { days, week: { ...openWeek, excusedDays: ['2026-11-11'] } }, '2026-11-14');
    expect(line(out, 'green-week')).toMatchObject({ status: 'earned', progress: { have: 4, need: 4 } });
  });

  it('a future excused weekday already drops out on Tuesday', () => {
    const days = [weekday('2026-11-09', 'met'), weekday('2026-11-10', 'met')];
    const out = evaluate(greenWeek, { days, week: { ...openWeek, excusedDays: ['2026-11-12'] } }, '2026-11-10');
    expect(line(out, 'green-week').progress).toEqual({ have: 2, need: 4 });
  });

  it('a normal-tier weekday counts: settled and not green ends the week', () => {
    const days = fiveGreen.map((d) => (d.day === '2026-11-11' ? weekday('2026-11-11', 'none') : d));
    const out = evaluate(greenWeek, { days }, '2026-11-14');
    expect(line(out, 'green-week')).toMatchObject({ status: 'none', note: 'Not green: 2026-11-11' });
  });

  it('without greenWeek on the facts (an older adapter) nothing changes', () => {
    const days = [...fiveGreen.map(({ greenWeek: _g, ...rest }) => rest), day('2026-11-14', 'exempt')];
    const out = evaluate(greenWeek, { days }, '2026-11-14');
    expect(line(out, 'green-week').status).toBe('earned');
  });
});

describe('Weekly Scripture coin — all seven days count', () => {
  const weekdays = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => sec(d, 'served'));

  it('a missed, settled Saturday loses the coin and names the day', () => {
    const out = evaluate(scriptureWeek, { sectionDays: [...weekdays, sec('2026-11-14', 'obligated'), sec('2026-11-15', 'served')] }, '2026-11-16');
    expect(line(out, 'scripture')).toMatchObject({ status: 'none', note: 'Not done: 2026-11-14' });
  });

  it('all seven served earns it', () => {
    const out = evaluate(scriptureWeek, { sectionDays: [...weekdays, sec('2026-11-14', 'served'), sec('2026-11-15', 'served')] }, '2026-11-16');
    expect(line(out, 'scripture').status).toBe('earned');
  });

  it('on Saturday payday, with Sunday still to come, it waits', () => {
    const out = evaluate(scriptureWeek, { sectionDays: [...weekdays, sec('2026-11-14', 'served')] }, '2026-11-14');
    expect(line(out, 'scripture').status).toBe('pending');
  });

  it('a Sunday that is itself excused does not hold the coin', () => {
    const out = evaluate(scriptureWeek, { sectionDays: [...weekdays, sec('2026-11-14', 'served'), sec('2026-11-15', 'excused', 'household_calendar')] }, '2026-11-15');
    expect(line(out, 'scripture').status).toBe('earned');
  });

  it('a learner whose weekend is not a scripture day is paid on Saturday as before', () => {
    const out = evaluate(scriptureWeek, { sectionDays: [...weekdays, sec('2026-11-14', 'excused', 'not_a_school_day')] }, '2026-11-14');
    expect(line(out, 'scripture').status).toBe('earned');
  });

  it('Green Week for the same week is weekdays only', () => {
    const both = ruleset([
      { id: 'green-week', kind: 'week-met', reward: 5 },
      { id: 'scripture', kind: 'section-week', match: { subject: 'scripture' }, reward: 5 },
    ]);
    const out = evaluate(both, {
      days: [...fiveGreen, weekend('2026-11-14', 'none')],
      sectionDays: [...weekdays, sec('2026-11-14', 'obligated')],
    }, '2026-11-15');
    expect(line(out, 'green-week').status).toBe('earned');
    expect(line(out, 'scripture').status).toBe('none');
  });
});
