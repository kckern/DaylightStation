// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  dayVerdict, weekVerdict, termDaysFor, resolveTermFor, weekIdFor, addDays, VERDICT_VERSION,
} from './termVerdict.mjs';

const TODAY = '2026-09-09';
const D = '2026-09-08';
const sec = (state, reason = null, subject = 'math') => ({ subject, state, reason });
const done = (faults = []) => ({ state: faults.length ? 'indeterminate' : 'complete', faults });

describe('dayVerdict — one test per rung', () => {
  it('1: a day after today is pending, whatever the sections say', () => {
    expect(dayVerdict({ studyDay: '2026-09-10', today: TODAY, completion: done(), sections: [sec('served')] }))
      .toMatchObject({ state: 'unknown', reason: 'pending' });
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: null, sections: [] }))
      .toMatchObject({ state: 'unknown', reason: 'pending' });
  });

  it('2: a fault is unknown with the fault named and a retryAfter', () => {
    const v = dayVerdict({
      studyDay: D, today: TODAY, completion: done([{ subject: 'math', reason: 'program_unavailable' }]),
      sections: [sec('faulted', 'program_unavailable')], computedAt: '2026-09-09T10:00:00.000Z',
    });
    expect(v).toMatchObject({ state: 'unknown', reason: 'program_unavailable', retryAfter: '2026-09-09T16:00:00.000Z' });
  });

  it('2b: only unrecorded programs assigned → unknown/no_history, NEVER blue', () => {
    const v = dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'no_work_today' }, sections: [sec('excused', 'no_history', 'other')] });
    expect(v).toMatchObject({ state: 'unknown', reason: 'no_history' });
    expect(v.state).not.toBe('exempt');
  });

  it('3: the house was off → exempt/household_calendar', () => {
    const v = dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'no_work_today' }, sections: [sec('excused', 'household_calendar'), sec('excused', 'no_history', 'other')] });
    expect(v).toMatchObject({ state: 'exempt', reason: 'household_calendar' });
  });

  it('4: every course said not a school day → exempt/not_a_school_day', () => {
    const v = dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'no_work_today' }, sections: [sec('excused', 'not_a_school_day'), sec('excused', 'not_a_school_day', 'english')] });
    expect(v).toMatchObject({ state: 'exempt', reason: 'not_a_school_day' });
  });

  it('5: no sections at all → exempt/no_work', () => {
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'no_work_today' }, sections: [] }))
      .toMatchObject({ state: 'exempt', reason: 'no_work' });
  });

  it('6: excused for other reasons → exempt/nothing_owed', () => {
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'no_work_today' }, sections: [sec('excused', 'caught_up')] }))
      .toMatchObject({ state: 'exempt', reason: 'nothing_owed' });
  });

  it('7: served everything asked → met', () => {
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: done(), sections: [sec('served'), sec('served', null, 'english')] }))
      .toMatchObject({ state: 'met', served: 2, asked: 2 });
  });

  it('8: served some → partial', () => {
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'incomplete' }, sections: [sec('served'), sec('obligated', null, 'english')] }))
      .toMatchObject({ state: 'partial', served: 1, asked: 2 });
  });

  it('9: served none → none', () => {
    expect(dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'incomplete' }, sections: [sec('obligated')] }))
      .toMatchObject({ state: 'none', served: 0, asked: 1 });
  });

  it('work done on an exempt Saturday still reads met — the calendar never un-serves', () => {
    const v = dayVerdict({ studyDay: '2026-09-05', today: TODAY, completion: done(), sections: [sec('served'), sec('excused', 'not_a_school_day', 'english')] });
    expect(v).toMatchObject({ state: 'met', weekday: 6 });
  });

  it('unknown always carries a reason', () => {
    for (const v of [
      dayVerdict({ studyDay: '2099-01-01', today: TODAY }),
      dayVerdict({ studyDay: D, today: TODAY, completion: { state: 'indeterminate', faults: [] }, sections: [sec('faulted', 'blocked_unreachable')] }),
    ]) {
      expect(v.state).toBe('unknown');
      expect(typeof v.reason).toBe('string');
    }
  });
});

describe('weekVerdict', () => {
  const W = '2026-09-07'; // Monday
  it('no weekly work anywhere → exempt/no_weekly_work', () => {
    expect(weekVerdict({ weekId: W, today: TODAY, days: [{ studyDay: W, weekly: [] }] })).toMatchObject({ state: 'exempt', reason: 'no_weekly_work', open: true });
  });
  it('a unit served on any day is done for the week', () => {
    const days = [
      { studyDay: W, weekly: [{ unitId: 'u', state: 'open' }] },
      { studyDay: addDays(W, 1), weekly: [{ unitId: 'u', state: 'served' }] },
      { studyDay: addDays(W, 2), weekly: [{ unitId: 'u', state: 'satisfied' }] },
    ];
    expect(weekVerdict({ weekId: W, today: TODAY, days })).toMatchObject({ state: 'met', served: 1, asked: 1 });
  });
  it('an open week with nothing served is pending, a closed one is none', () => {
    const days = [{ studyDay: W, weekly: [{ unitId: 'u', state: 'open' }] }];
    expect(weekVerdict({ weekId: W, today: TODAY, days })).toMatchObject({ state: 'unknown', reason: 'pending', open: true });
    expect(weekVerdict({ weekId: '2026-08-31', today: TODAY, days: [{ studyDay: '2026-08-31', weekly: [{ unitId: 'u', state: 'open' }] }] }))
      .toMatchObject({ state: 'none', open: false });
  });
});

describe('term bounds', () => {
  const periods = [
    { periodId: '2026-27', kind: 'year', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2027-05-29T07:00:00.000Z' },
    { periodId: '2026-fall', kind: 'semester', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T07:00:00.000Z', parentPeriodId: '2026-27', label: 'Fall 2026' },
  ];
  it('picks the most specific period containing today and reads inclusive day bounds', () => {
    expect(resolveTermFor(periods, { today: TODAY })).toEqual({ termId: '2026-fall', label: 'Fall 2026', from: '2026-08-01', to: '2026-12-18' });
  });
  it('an explicit window narrows, never widens', () => {
    expect(resolveTermFor(periods, { today: TODAY, window: { from: '2026-09-01', to: '2026-12-31' } }))
      .toMatchObject({ from: '2026-09-01', to: '2026-12-18' });
    expect(resolveTermFor(periods, { today: TODAY, window: { from: '2026-07-01' } })).toMatchObject({ from: '2026-08-01' });
  });
  it('a day outside every period has no term', () => {
    expect(resolveTermFor(periods, { today: '2027-07-01' })).toBeNull();
  });
  it('termDaysFor is inclusive and refuses a reversed range', () => {
    expect(termDaysFor('2026-09-01', '2026-09-03')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(termDaysFor('2026-09-03', '2026-09-01')).toEqual([]);
  });
  it('weekIdFor is the Monday, Sunday included', () => {
    expect(weekIdFor('2026-09-13')).toBe('2026-09-07');
    expect(weekIdFor('2026-09-07')).toBe('2026-09-07');
  });
  it('the ladder is versioned', () => { expect(VERDICT_VERSION).toBe(1); });
});
