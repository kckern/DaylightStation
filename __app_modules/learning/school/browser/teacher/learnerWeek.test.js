import { describe, it, expect } from 'vitest';
import { weekDays, buildWeek } from "./learnerWeek.js";

describe('weekDays', () => {
  it('lists the seven days ending on the given day, oldest first', () => {
    expect(weekDays('2026-10-21')).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  });
  it('crosses a month and a DST change cleanly', () => {
    expect(weekDays('2026-11-02', 3)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('buildWeek', () => {
  const day = (studyDay, sections, sessions = [], extra = {}) => ({ studyDay, sections, sessions, known: true, ...extra });

  it('counts planned lessons done per day and keeps one cell per subject per day', () => {
    const week = buildWeek([
      day('2026-10-20', [{ subject: 'math', next: { unitId: 'm1', title: 'A' } }, { subject: 'arts', next: { unitId: 'a1', title: 'B' } }],
        [{ sessionId: 's1', subject: 'math', unitId: 'm1', state: 'graded', effectiveScore: { correctCount: 9, totalCount: 10, percent: 90 } }]),
      day('2026-10-21', [{ subject: 'math', next: { unitId: 'm2', title: 'C' } }]),
    ]);
    expect(week.totals).toEqual([
      { studyDay: '2026-10-20', done: 1, planned: 2, known: true },
      { studyDay: '2026-10-21', done: 0, planned: 1, known: true },
    ]);
    const math = week.subjects.find((s) => s.subject === 'math');
    expect(math.cells['2026-10-20']).toEqual({ status: 'done', percent: 90 });
    expect(math.cells['2026-10-21'].status).toBe('planned');
    expect(week.subjects.find((s) => s.subject === 'arts').cells['2026-10-21']).toBeUndefined();
  });

  it('shows the least-finished row when a subject has two on one day', () => {
    const week = buildWeek([day('2026-10-20', [
      { subject: 'math', next: { unitId: 'm1', title: 'A' } },
      { subject: 'math', next: { unitId: 'm2', title: 'B' } },
    ], [{ sessionId: 's1', subject: 'math', unitId: 'm1', effectiveScore: { correctCount: 1, totalCount: 1, percent: 100 } }])]);
    expect(week.subjects[0].cells['2026-10-20']).toEqual({ status: 'planned', percent: null });
    expect(week.totals[0]).toMatchObject({ done: 1, planned: 2 });
  });

  it('leaves out a subject with nothing assigned, and counts unplanned work as done but not planned', () => {
    const week = buildWeek([day('2026-10-20', [{ subject: 'scripture', next: null }],
      [{ sessionId: 's9', subject: 'piano', unitId: 'p1', effectiveScore: { correctCount: 3, totalCount: 4, percent: 75 } }])]);
    expect(week.subjects.map((s) => s.subject)).toEqual(['piano']);
    expect(week.subjects[0].cells['2026-10-20']).toEqual({ status: 'done', percent: 75 });
    expect(week.totals[0]).toEqual({ studyDay: '2026-10-20', done: 0, planned: 0, known: true });
  });

  it('credits a carried-over sheet the day served the subject, as the Day record does', () => {
    const week = buildWeek([day('2026-10-20', [{ subject: 'math', servedToday: true, next: null }], [], {
      carriedOver: [{ sessionId: 's2', subject: 'math', unitId: 'm1', studyDay: '2026-10-19', effectiveScore: { correctCount: 4, totalCount: 5, percent: 80 } }],
    })]);
    expect(week.subjects[0].cells['2026-10-20']).toEqual({ status: 'done', percent: 80 });
    expect(week.totals[0]).toMatchObject({ done: 1, planned: 1 });
  });

  it('marks a day it could not read as unknown', () => {
    const week = buildWeek([{ studyDay: '2026-10-20', sections: [], sessions: [], known: false }]);
    expect(week.totals[0]).toEqual({ studyDay: '2026-10-20', done: 0, planned: 0, known: false });
  });
});
