import { describe, it, expect } from 'vitest';
import {
  weekDays, shiftWeek, dayLabel, weekLabel, workGrid, statusText, editableRate, ratePatch,
} from './earningsModel.js';

describe('earningsModel — week arithmetic', () => {
  it('lists the seven study days from Monday', () => {
    expect(weekDays('2026-09-21')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  });
  it('steps whole weeks, across a month end', () => {
    expect(shiftWeek('2026-09-28', 1)).toBe('2026-10-05');
    expect(shiftWeek('2026-09-21', -1)).toBe('2026-09-14');
  });
  it('labels a day and a week for a person, not a parser', () => {
    expect(dayLabel('2026-09-21')).toBe('Mon 21');
    expect(weekLabel({ from: '2026-09-21', to: '2026-09-27' })).toBe('Sep 21 – 27');
    expect(weekLabel({ from: '2026-09-28', to: '2026-10-04' })).toBe('Sep 28 – Oct 4');
  });
});

describe('earningsModel — the week\'s work grid', () => {
  const work = {
    days: [
      { day: '2026-09-21', state: 'met' },
      { day: '2026-09-22', state: 'partial' },
    ],
    sectionDays: [
      { day: '2026-09-21', subject: 'scripture', state: 'served' },
      { day: '2026-09-22', subject: 'scripture', state: 'obligated' },
      { day: '2026-09-21', subject: 'language', state: 'served' },
      { day: '2026-09-26', subject: 'language', state: 'served' },
    ],
  };

  it('one row per subject (sorted), one cell per day, empty where nothing was asked', () => {
    const grid = workGrid(work, '2026-09-21');
    expect(grid.days).toHaveLength(7);
    expect(grid.dayRow.map((c) => c.state)).toEqual(['met', 'partial', null, null, null, null, null]);
    expect(grid.subjects.map((r) => r.subject)).toEqual(['language', 'scripture']);
    expect(grid.subjects[1].cells.map((c) => c.state)).toEqual(['served', 'obligated', null, null, null, null, null]);
    expect(grid.subjects[0].cells[5].state).toBe('served');
  });

  it('an empty week still draws seven columns', () => {
    const grid = workGrid({}, '2026-09-21');
    expect(grid.days).toHaveLength(7);
    expect(grid.subjects).toEqual([]);
  });
});

describe('earningsModel — lines', () => {
  it('says what each status means in words a parent reads', () => {
    expect(statusText('earned')).toBe('Earned');
    expect(statusText('pending')).toBe('Pending');
    expect(statusText('indeterminate')).toBe('Can’t tell yet');
    expect(statusText('none')).toBe('Not this week');
    expect(statusText('disabled')).toBe('Off');
  });

  it('the editable rate is the silver reward, or the ring ratio\'s silver for ring-threshold', () => {
    expect(editableRate({ kind: 'section-day', priced: { reward: { silver: 2, gems: 0 } } })).toEqual({ field: 'reward', silver: 2, unit: 'each' });
    expect(editableRate({ kind: 'week-met', priced: { reward: { silver: 5, gems: 1 } } })).toEqual({ field: 'reward', silver: 5, unit: 'once' });
    expect(editableRate({ kind: 'ring-threshold', priced: { rate: { rings: 100, silver: 1 } } })).toEqual({ field: 'rate', silver: 1, unit: 'per 100 rings' });
  });

  it('a rate patch keeps the gems and the ring ratio it does not edit', () => {
    expect(ratePatch({ ruleId: 'green-week', kind: 'week-met', priced: { reward: { silver: 5, gems: 1 } } }, 7))
      .toEqual({ rules: { 'green-week': { reward: { silver: 7, gems: 1 } } } });
    expect(ratePatch({ ruleId: 'rings', kind: 'ring-threshold', priced: { rate: { rings: 100, silver: 1 } } }, 2))
      .toEqual({ rules: { rings: { rate: { rings: 100, silver: 2 } } } });
  });
});
