// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { withSubjectDone } from './whatIf.mjs';

const facts = () => ({
  sectionDays: [
    { day: '2026-10-20', subject: 'language', state: 'obligated', reason: null, timeliness: 'on-time' },
    { day: '2026-10-20', subject: 'math', state: 'obligated', reason: null, timeliness: 'on-time' },
    { day: '2026-10-19', subject: 'language', state: 'obligated', reason: null, timeliness: 'on-time' },
  ],
  days: [{ day: '2026-10-20', state: 'none', reason: null, timeliness: 'on-time' }],
  week: null,
  units: [],
});

describe('withSubjectDone', () => {
  it('serves only that subject on that day, leaving the input untouched', () => {
    const before = facts();
    const out = withSubjectDone(before, { day: '2026-10-20', subject: 'language' });
    expect(out.sectionDays.map((r) => [r.day, r.subject, r.state])).toEqual([
      ['2026-10-20', 'language', 'served'], ['2026-10-20', 'math', 'obligated'], ['2026-10-19', 'language', 'obligated'],
    ]);
    expect(before.sectionDays[0].state).toBe('obligated');
    expect(out.days[0].state).toBe('none');
    expect(out.units).toEqual([]);
  });

  it('adds a served row for a subject with no row that day', () => {
    const out = withSubjectDone(facts(), { day: '2026-10-20', subject: 'science' });
    expect(out.sectionDays.at(-1)).toEqual({ day: '2026-10-20', subject: 'science', state: 'served', reason: null, timeliness: 'on-time' });
  });

  it('adds a passed unit when a unit is named, and greens the day only when told', () => {
    const out = withSubjectDone(facts(), { day: '2026-10-20', subject: 'language', unitId: 'ko.07', courseId: 'ko', finishesDay: true });
    expect(out.units).toEqual([{ day: '2026-10-20', unitId: 'ko.07', subject: 'language', courseId: 'ko', result: 'passed', timeliness: 'on-time' }]);
    expect(out.days[0].state).toBe('met');
    const noRow = withSubjectDone({ ...facts(), days: [] }, { day: '2026-10-20', subject: 'language', finishesDay: true });
    expect(noRow.days).toEqual([{ day: '2026-10-20', state: 'met', reason: null, timeliness: 'on-time' }]);
  });
});
