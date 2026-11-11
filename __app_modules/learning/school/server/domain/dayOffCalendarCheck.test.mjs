import { describe, it, expect } from 'vitest';
import { checkDayOffCalendar } from './dayOffPolicy.mjs';

const schedule = {
  except: [
    { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day' },
    { from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'enrichment', replaces: 'civilization', assignment: 'holiday-veterans-day' },
    { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' },
    { from: '2026-12-24', to: '2026-12-25', label: 'Christmas', tier: 'major-holiday', assignment: 'holiday-christmas' },
    { from: '2026-12-21', to: '2026-12-23', label: 'Winter break', tier: 'stay-home' },
  ],
};
const unit = (unitId, subject, onDays) => ({ unitId, subject, onDays });

describe('checkDayOffCalendar', () => {
  it('lists untiered breaks by label', () => {
    expect(checkDayOffCalendar({ schedule }).untiered).toEqual(['Labor Day']);
  });

  it('names an assignment that is not a published unit, or does not cover the break, or swaps the wrong subject', () => {
    const units = [
      unit('holiday-thanksgiving', 'scripture', [{ from: '2026-11-26', to: '2026-11-26' }]),
      // Covers only the 24th of a two-day break.
      unit('holiday-christmas', 'scripture', [{ from: '2026-12-24', to: '2026-12-24' }]),
    ];
    expect(checkDayOffCalendar({ schedule, units }).missingAssignments).toEqual([
      { label: 'Veterans Day', assignment: 'holiday-veterans-day' },
      { label: 'Christmas', assignment: 'holiday-christmas' },
    ]);
    const wrongSubject = [unit('holiday-veterans-day', 'math', [{ from: '2026-11-11', to: '2026-11-11' }])];
    expect(checkDayOffCalendar({ schedule: { except: [schedule.except[1]] }, units: wrongSubject }).missingAssignments)
      .toEqual([{ label: 'Veterans Day', assignment: 'holiday-veterans-day' }]);
  });

  it('is clean when every assignment resolves and covers its break', () => {
    const units = [
      unit('holiday-veterans-day', 'civilization', ['2026-11-11']),
      unit('holiday-thanksgiving', 'scripture', ['2026-11-26']),
      unit('holiday-christmas', 'scripture', [{ from: '2026-12-24', to: '2026-12-25' }]),
    ];
    expect(checkDayOffCalendar({ schedule, units }).missingAssignments).toEqual([]);
  });

  it('answers empty for no calendar', () => {
    expect(checkDayOffCalendar({ schedule: null })).toEqual({ untiered: [], missingAssignments: [] });
  });
});
