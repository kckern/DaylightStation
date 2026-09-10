import { describe, it, expect } from 'vitest';
import { isSchoolDay, namedDayOff, validateSchedule } from '#domains/school/schoolCalendar.mjs';

describe('isSchoolDay', () => {
  it('is true for every day when there is no schedule', () => {
    expect(isSchoolDay('2026-08-29', null)).toBe(true); // a Saturday
  });

  it('honours daysOfWeek — ISO 1=Monday', () => {
    const s = { daysOfWeek: [1, 2, 3, 4, 5] };
    expect(isSchoolDay('2026-08-26', s)).toBe(true); // Wednesday
    expect(isSchoolDay('2026-08-29', s)).toBe(false); // Saturday
    expect(isSchoolDay('2026-08-30', s)).toBe(false); // Sunday
    expect(isSchoolDay('2026-08-31', s)).toBe(true); // Monday
  });

  it('excludes a single excepted date', () => {
    expect(isSchoolDay('2026-11-26', { daysOfWeek: [1, 2, 3, 4, 5], except: ['2026-11-26'] })).toBe(false);
  });

  it('excludes an excepted range, inclusive at both ends', () => {
    const s = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-12-21', to: '2027-01-01' }] };
    expect(isSchoolDay('2026-12-21', s)).toBe(false);
    expect(isSchoolDay('2026-12-25', s)).toBe(false);
    expect(isSchoolDay('2027-01-01', s)).toBe(false);
    expect(isSchoolDay('2027-01-04', s)).toBe(true); // the Monday after
  });

  it('`also` beats `except` — a makeup day inside a vacation range still counts', () => {
    const s = {
      daysOfWeek: [1, 2, 3, 4, 5],
      except: [{ from: '2026-12-21', to: '2027-01-01' }],
      also: ['2026-12-23'],
    };
    expect(isSchoolDay('2026-12-23', s)).toBe(true);
    expect(isSchoolDay('2026-12-24', s)).toBe(false);
  });

  it('`also` beats daysOfWeek — a Saturday makeup day counts', () => {
    expect(isSchoolDay('2026-08-29', { daysOfWeek: [1, 2, 3, 4, 5], also: ['2026-08-29'] })).toBe(true);
  });

  it('is timezone-free — it compares calendar keys, never Date arithmetic across a boundary', () => {
    // A study-day key is already local. Parsing it as UTC and reading the local
    // weekday would shift a Sunday to a Saturday west of Greenwich.
    expect(isSchoolDay('2026-08-30', { daysOfWeek: [7] })).toBe(true); // Sunday
  });

  it('fails OPEN on a malformed schedule — never silently excuses a whole term', () => {
    expect(isSchoolDay('2026-08-26', { daysOfWeek: 'weekdays' })).toBe(true);
  });

  it('fails OPEN on a TYPO\'d key — the validator catches bad values, not bad keys', () => {
    expect(isSchoolDay('2026-08-29', { daysofweek: [1, 2, 3, 4, 5] })).toBe(true);
    expect(isSchoolDay('2026-11-26', { daysOfWeek: [1, 2, 3, 4, 5], exept: ['2026-11-26'] })).toBe(true);
  });

  it('runs a weekend-only course — ISO 7 is Sunday, not a 0-indexed anything', () => {
    const s = { daysOfWeek: [6, 7] };
    expect(isSchoolDay('2026-08-29', s)).toBe(true); // Saturday
    expect(isSchoolDay('2026-08-30', s)).toBe(true); // Sunday
    expect(isSchoolDay('2026-08-31', s)).toBe(false); // Monday
    expect(isSchoolDay('2026-09-04', s)).toBe(false); // Friday
  });

  it('`also` wins when the SAME date is named by both — the likeliest authoring accident', () => {
    const s = { daysOfWeek: [1, 2, 3, 4, 5], except: ['2026-11-26'], also: ['2026-11-26'] };
    expect(isSchoolDay('2026-11-26', s)).toBe(true);
  });

  it('reads a one-day {from, to} span the same as the bare date', () => {
    expect(isSchoolDay('2026-11-26', { except: [{ from: '2026-11-26', to: '2026-11-26' }] })).toBe(false);
    expect(isSchoolDay('2026-11-27', { except: [{ from: '2026-11-26', to: '2026-11-26' }] })).toBe(true);
  });

  it('derives the weekday of a two-digit year correctly — 0026 is not 1926', () => {
    // Unreachable from a system clock, but this is an exported pure function:
    // Date.UTC maps a year under 100 into the 1900s unless it is set explicitly.
    // 0026-11-01 is a Sunday; read as 1926 it is a Monday.
    expect(isSchoolDay('0026-11-01', { daysOfWeek: [1, 2, 3, 4, 5] })).toBe(false);
    expect(isSchoolDay('0026-11-01', { daysOfWeek: [7] })).toBe(true);
  });
});

describe('validateSchedule', () => {
  it('accepts an absent schedule', () => {
    expect(validateSchedule(undefined)).toEqual({ errors: [], schedule: null });
  });

  it('refuses a weekday outside 1..7', () => {
    expect(validateSchedule({ daysOfWeek: [0] }).errors[0]).toMatch(/daysOfWeek/);
    expect(validateSchedule({ daysOfWeek: [8] }).errors[0]).toMatch(/daysOfWeek/);
  });

  it('refuses an empty daysOfWeek — that is a term with no school days at all', () => {
    expect(validateSchedule({ daysOfWeek: [] }).errors[0]).toMatch(/daysOfWeek/);
  });

  it('refuses a malformed date', () => {
    expect(validateSchedule({ except: ['Christmas'] }).errors[0]).toMatch(/except/);
  });

  it('refuses a range that ends before it starts', () => {
    expect(validateSchedule({ except: [{ from: '2026-12-25', to: '2026-12-01' }] }).errors[0]).toMatch(/before/);
  });

  it('normalizes and dedupes, sorting daysOfWeek', () => {
    expect(validateSchedule({ daysOfWeek: [3, 1, 3] }).schedule.daysOfWeek).toEqual([1, 3]);
  });

  it('refuses an unknown key — a typo must not read as an empty schedule', () => {
    expect(validateSchedule({ daysofweek: [1, 2, 3, 4, 5] }).errors[0]).toMatch(/daysofweek/);
    expect(validateSchedule({ daysOfWeek: [1], holidays: [] }).errors[0]).toMatch(/holidays/);
  });

  it('returns no schedule when nothing recognised survived — an empty block is not a schedule', () => {
    expect(validateSchedule({})).toEqual({ errors: [], schedule: null });
    expect(validateSchedule({ daysOfWeek: null, except: [], also: [] })).toEqual({ errors: [], schedule: null });
  });

  it('normalizes a bare date to a one-day span so membership is one comparison', () => {
    expect(validateSchedule({ except: ['2026-11-26'] }).schedule.except)
      .toEqual([{ from: '2026-11-26', to: '2026-11-26' }]);
  });

  it('never returns a schedule alongside errors', () => {
    expect(validateSchedule({ daysOfWeek: [1], except: ['nope'] }).schedule).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A NAMED day off. There are two different reasons a day asks nothing of a
// child, and a wall of squares must not draw them alike: a Saturday is the
// ordinary rhythm and recedes, while Thanksgiving is a thing that happened and
// is worth seeing. Only a named span can answer the second.
describe('namedDayOff', () => {
  const FALL = {
    daysOfWeek: [1, 2, 3, 4, 5],
    except: [
      { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day' },
      { from: '2026-11-25', to: '2026-11-27', label: 'Thanksgiving' },
      { from: '2026-12-21', to: '2026-12-31', label: 'Christmas break' },
    ],
  };
  const nameAt = (day, schedule = FALL) => namedDayOff(day, schedule)?.label ?? null;

  it.each([
    ['the single day it names', '2026-09-07', 'Labor Day'],
    ['the first day of a span', '2026-11-25', 'Thanksgiving'],
    ['a day inside a span', '2026-11-26', 'Thanksgiving'],
    ['the last day of a span', '2026-11-27', 'Thanksgiving'],
    ['the last day of the term', '2026-12-31', 'Christmas break'],
  ])('names %s', (_label, day, expected) => {
    expect(nameAt(day)).toBe(expected);
  });

  it.each([
    ['the school day before a break', '2026-11-24'],
    ['the school day after one', '2026-11-30'],
    ['a day past the last span', '2027-01-04'],
  ])('leaves %s unnamed', (_label, day) => {
    expect(nameAt(day)).toBeNull();
  });

  it('does not name a weekend, which is the rhythm rather than an occasion', () => {
    expect(nameAt('2026-11-28')).toBeNull();          // a Saturday
    expect(isSchoolDay('2026-11-28', FALL)).toBe(false);
  });

  it('lets a makeup day beat the vacation containing it, exactly as the verdict does', () => {
    const withMakeup = { ...FALL, also: ['2026-11-26'] };
    expect(nameAt('2026-11-26', withMakeup)).toBeNull();
    expect(isSchoolDay('2026-11-26', withMakeup)).toBe(true);
  });

  it('ignores an unnamed span — there is nothing to write on a square', () => {
    expect(nameAt('2026-10-05', { except: [{ from: '2026-10-05', to: '2026-10-05' }] })).toBeNull();
    expect(isSchoolDay('2026-10-05', { except: [{ from: '2026-10-05', to: '2026-10-05' }] })).toBe(false);
  });

  it('trims a hand-typed name and refuses a blank one', () => {
    const named = (label) => ({ except: [{ from: '2026-10-05', to: '2026-10-05', label }] });
    expect(nameAt('2026-10-05', named('  Fall break  '))).toBe('Fall break');
    expect(nameAt('2026-10-05', named('   '))).toBeNull();
  });

  it.each([
    ['no schedule', null], ['an empty schedule', {}], ['an invalid one', { daysOfWeek: 'weekdays' }],
  ])('answers null for %s rather than inventing an occasion', (_label, schedule) => {
    expect(namedDayOff('2026-11-26', schedule)).toBeNull();
  });
});
