import { describe, it, expect } from 'vitest';
import { isSchoolDay, validateSchedule } from '#domains/school/schoolCalendar.mjs';

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

  it('normalizes a bare date to a one-day span so membership is one comparison', () => {
    expect(validateSchedule({ except: ['2026-11-26'] }).schedule.except)
      .toEqual([{ from: '2026-11-26', to: '2026-11-26' }]);
  });

  it('never returns a schedule alongside errors', () => {
    expect(validateSchedule({ daysOfWeek: [1], except: ['nope'] }).schedule).toBeNull();
  });
});
