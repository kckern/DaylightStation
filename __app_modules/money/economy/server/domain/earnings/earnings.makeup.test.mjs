import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings } from "./index.mjs";

// School makeup (taxonomy D14): a missed weekday that can still be made up
// carries `makeupOpen` and is not settled until its deadline.
// Mon 2026-11-09 … Sun 2026-11-15.
const WEEK = { from: '2026-11-09', to: '2026-11-15' };
const ruleset = (rules) => validateRuleset({ revision: 4, currency: 'silver', rules, users: {} });
const weekday = (d, state, extra = {}) => ({ day: d, state, reason: null, timeliness: 'on-time', greenWeek: true, ...extra });
const sec = (d, state, extra = {}) => ({ day: d, subject: 'math', state, reason: null, timeliness: 'on-time', ...extra });
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
const mathWeek = ruleset([{ id: 'math', kind: 'section-week', match: { subject: 'math' }, reward: 5 }]);
const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

describe('Green Week with makeup', () => {
  it('a recoverable Wednesday keeps the week pending instead of ending it', () => {
    const facts = { days: days.map((d) => (d === '2026-11-11' ? weekday(d, 'partial', { makeupOpen: true }) : weekday(d, 'met'))) };
    expect(line(evaluate(greenWeek, facts, '2026-11-14'), 'green-week').status).toBe('pending');
  });

  it('made up, the week is earned', () => {
    const facts = { days: days.map((d) => (d === '2026-11-11' ? weekday(d, 'met', { timeliness: 'makeup' }) : weekday(d, 'met'))) };
    expect(line(evaluate(greenWeek, facts, '2026-11-15'), 'green-week').status).toBe('earned');
  });

  it('past the deadline (no longer makeupOpen) the week is lost as before', () => {
    const facts = { days: days.map((d) => (d === '2026-11-11' ? weekday(d, 'partial') : weekday(d, 'met'))) };
    expect(line(evaluate(greenWeek, facts, '2026-11-15'), 'green-week')).toMatchObject({ status: 'none', note: 'Not green: 2026-11-11' });
  });
});

describe('Section week with makeup', () => {
  it('names the day that can still be made up', () => {
    const sectionDays = days.map((d) => (d === '2026-11-11' ? sec(d, 'obligated', { makeupOpen: true }) : sec(d, 'served')));
    expect(line(evaluate(mathWeek, { sectionDays }, '2026-11-14'), 'math')).toMatchObject({ status: 'pending', note: 'Can still make up: 2026-11-11' });
  });
});

describe('makeup coin penalty (earn-rules makeup)', () => {
  const rs = (makeup, rules) => validateRuleset({ revision: 1, currency: 'silver', makeup, rules, users: {} });
  const greenWeekRule = { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } };
  const greenDayRule = { id: 'green-day', kind: 'day-met', reward: { silver: 2 } };
  const madeUpWed = days.map((d) => (d === '2026-11-11' ? weekday(d, 'met', { timeliness: 'makeup' }) : weekday(d, 'met')));

  it('percent takes that share of the week once per made-up day, and keeps the gem', () => {
    const out = evaluate(rs({ percent: 40 }, [greenWeekRule]), { days: madeUpWed }, '2026-11-15');
    expect(line(out, 'green-week')).toMatchObject({
      status: 'earned', amount: { silver: 3, gems: 1 }, makeup: { days: ['2026-11-11'], deducted: 2 },
    });
    expect(line(out, 'green-week').note).toBe('Made up 2026-11-11: -2 silver');
  });

  it('a per-day rule loses part of the made-up day only', () => {
    const out = evaluate(rs({ percent: 50 }, [greenDayRule]), { days: madeUpWed }, '2026-11-15');
    expect(line(out, 'green-day').amount.silver).toBe(9); // 5 days x 2, less half of one day
  });

  it('a flat penalty never goes below zero', () => {
    const out = evaluate(rs({ silver: 3 }, [greenDayRule]), { days: madeUpWed }, '2026-11-15');
    expect(line(out, 'green-day').amount.silver).toBe(7);
    const twoMadeUp = madeUpWed.map((d) => (d.day === '2026-11-12' ? { ...d, timeliness: 'makeup' } : d));
    const week = evaluate(rs({ silver: 4 }, [greenWeekRule]), { days: twoMadeUp }, '2026-11-15');
    expect(line(week, 'green-week').amount).toEqual({ silver: 0, gems: 1 });
  });

  it("a rule's own makeup replaces the household one; percent 0 exempts it", () => {
    const out = evaluate(rs({ percent: 50 }, [{ ...greenWeekRule, makeup: { percent: 0 } }]), { days: madeUpWed }, '2026-11-15');
    expect(line(out, 'green-week').amount).toEqual({ silver: 5, gems: 1 });
  });

  it('a section rule counts only its own subject made up', () => {
    const sectionDays = days.map((d) => (d === '2026-11-11' ? sec(d, 'served', { timeliness: 'makeup' }) : sec(d, 'served')));
    const out = evaluate(rs({ silver: 2 }, [{ id: 'math', kind: 'section-week', match: { subject: 'math' }, reward: 5 }]), { sectionDays }, '2026-11-15');
    expect(line(out, 'math').amount.silver).toBe(3);
  });

  it('no makeup config, no penalty', () => {
    const out = evaluate(rs(undefined, [greenWeekRule]), { days: madeUpWed }, '2026-11-15');
    expect(line(out, 'green-week').amount).toEqual({ silver: 5, gems: 1 });
  });

  it('rejects a malformed block', () => {
    expect(() => rs({ percent: 150 }, [greenWeekRule])).toThrow(/percent/);
    expect(() => rs({ percent: 10, silver: 1 }, [greenWeekRule])).toThrow(/exactly one/);
  });
});
