// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SchoolEarningEvidence } from './SchoolEarningEvidence.mjs';

const WEEK = { from: '2026-09-21', to: '2026-09-27' };
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function termVerdicts(term) {
  const calls = [];
  return { calls, async read(learnerId, opts) { calls.push({ learnerId, opts }); return term; } };
}

const TERM = {
  term: { termId: 'fall' },
  days: [
    { studyDay: '2026-09-20', state: 'met', reason: null, sections: [{ subject: 'language', state: 'served', reason: null }] },
    { studyDay: '2026-09-21', state: 'met', reason: null, sections: [
      { subject: 'language', state: 'served', reason: null },
      { subject: 'scripture', state: 'served', reason: null },
    ] },
    { studyDay: '2026-09-22', state: 'partial', reason: null, sections: [
      { subject: 'language', state: 'obligated', reason: null },
      { subject: 'scripture', state: 'excused', reason: 'weekly_satisfied' },
    ] },
    { studyDay: '2026-09-26', state: 'exempt', reason: 'not_a_school_day', sections: [{ subject: 'language', state: 'served', reason: null }] },
  ],
  weeks: [
    { weekId: '2026-09-14', state: 'met', reason: null, open: false },
    { weekId: '2026-09-21', state: 'partial', reason: null, open: true },
  ],
};

const sessions = (rows) => ({ async execute() { return rows; } });

describe('SchoolEarningEvidence.schoolWeek', () => {
  it('reads the term grid WITH per-subject detail and keeps only the week\'s days', async () => {
    const tv = termVerdicts(TERM);
    const evidence = new SchoolEarningEvidence({ termVerdicts: tv, sessions: sessions([]), logger: silent });
    const out = await evidence.schoolWeek({ learnerId: 'learner-a', week: WEEK });
    expect(tv.calls[0]).toEqual({ learnerId: 'learner-a', opts: { detail: true } });
    expect(out.days.map((d) => [d.day, d.state])).toEqual([['2026-09-21', 'met'], ['2026-09-22', 'partial'], ['2026-09-26', 'exempt']]);
    expect(out.sectionDays).toContainEqual({ day: '2026-09-22', subject: 'scripture', state: 'excused', reason: 'weekly_satisfied', timeliness: 'on-time' });
    expect(out.sectionDays.filter((s) => s.subject === 'language').map((s) => s.day)).toEqual(['2026-09-21', '2026-09-22', '2026-09-26']);
    expect(out.week).toEqual({ weekId: '2026-09-21', state: 'partial', reason: null, open: true });
  });

  it('units are the week\'s graded sessions, with subject and course from the curriculum', async () => {
    const evidence = new SchoolEarningEvidence({
      termVerdicts: termVerdicts(TERM),
      sessions: sessions([
        { unitId: 'em23-03-01', studyDay: '2026-09-21', state: 'graded', outcome: { result: 'passed' } },
        { unitId: 'em23-03-02', studyDay: '2026-09-22', state: 'issued', outcome: null },
        { unitId: 'em23-02-09', studyDay: '2026-09-19', state: 'graded', outcome: { result: 'passed' } },
      ]),
      unitInfo: async (unitId) => (unitId.startsWith('em23') ? { subject: 'math', courseId: 'elementary-math-2-3' } : null),
      logger: silent,
    });
    const out = await evidence.schoolWeek({ learnerId: 'learner-a', week: WEEK });
    expect(out.units).toEqual([{ day: '2026-09-21', unitId: 'em23-03-01', subject: 'math', courseId: 'elementary-math-2-3', result: 'passed', timeliness: 'on-time' }]);
  });

  it('a week outside every term reads empty with no week verdict', async () => {
    const evidence = new SchoolEarningEvidence({ termVerdicts: termVerdicts({ term: null, days: [], weeks: [] }), sessions: sessions([]), logger: silent });
    expect(await evidence.schoolWeek({ learnerId: 'learner-a', week: WEEK })).toEqual({ sectionDays: [], days: [], week: null, units: [] });
  });

  it('a unit lookup that fails leaves subject and course null rather than failing the week', async () => {
    const evidence = new SchoolEarningEvidence({
      termVerdicts: termVerdicts(TERM),
      sessions: sessions([{ unitId: 'x-1', studyDay: '2026-09-21', state: 'graded', outcome: { result: 'passed' } }]),
      unitInfo: async () => { throw new Error('catalog down'); },
      logger: silent,
    });
    const out = await evidence.schoolWeek({ learnerId: 'learner-a', week: WEEK });
    expect(out.units[0]).toMatchObject({ unitId: 'x-1', subject: null, courseId: null });
  });
});
