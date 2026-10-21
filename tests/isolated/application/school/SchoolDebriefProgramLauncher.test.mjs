// tests/isolated/application/school/SchoolDebriefProgramLauncher.test.mjs
import { describe, it, expect } from 'vitest';
import { SchoolDebriefProgramLauncher } from "../../../../__app_modules/learning/school/server/application/SchoolDebriefProgramLauncher.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const SCHED = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-10-19', to: '2026-10-19' }] };
function make({ days = {}, enrolled = true, readThrows = false, now = '2026-10-21T22:00:00Z', household = null } = {}) {
  const debriefs = { read: async (_l, d) => { if (readThrows) return { status: 'unreadable', events: [] }; return { status: days[d] ? 'ok' : 'missing', events: days[d] ?? [] }; } };
  const assignments = { get: async () => ({ programs: enrolled ? [{ programId: 'school-debrief', corpusId: null, subject: 'writing', title: 'After-school debrief', schedule: SCHED }] : [] }) };
  const grants = { issue: ({ learnerId, days: d }) => `grant:${learnerId}:${d.join(',')}` };
  return new SchoolDebriefProgramLauncher({ debriefs, assignments, grants, householdSchedule: household, timezone: 'UTC', clock: () => new Date(now), logger: silent });
}
const done = [{ type: 'questions', substance: 7, questions: [], questioner: 'model', at: 'x' }, { type: 'completed', at: 'y' }];

describe('SchoolDebriefProgramLauncher', () => {
  it('identity', () => { const l = make(); expect([l.id, l.surface, l.replayable]).toEqual(['school-debrief', 'portal', true]); });
  it('open day: not done, empty servedWork, progress 0/1', async () => {
    const s = await make().status({ userId: 'test-learner' });
    expect(s).toMatchObject({ error: false, doneToday: false, servedWork: [], obligationProgress: { completed: 0, total: 1 }, progressLabel: 'Not started' });
  });
  it('completed day: done, servedWork row', async () => {
    const s = await make({ days: { '2026-10-21': done } }).status({ userId: 'test-learner' });
    expect(s.doneToday).toBe(true);
    expect(s.servedWork).toEqual([{ unitId: 'school-debrief:daily', title: 'After-school debrief' }]);
  });
  it('excused counts as done; rejected does not', async () => {
    expect((await make({ days: { '2026-10-21': [{ type: 'excused', at: 'x' }] } }).status({ userId: 'test-learner' })).doneToday).toBe(true);
    expect((await make({ days: { '2026-10-21': [...done, { type: 'rejected', at: 'z' }] } }).status({ userId: 'test-learner' })).doneToday).toBe(false);
  });
  it('unreadable store is an error, never a false zero', async () => {
    const s = await make({ readThrows: true }).status({ userId: 'test-learner' });
    expect(s).toMatchObject({ error: true, obligationProgress: null, servedWork: [] });
  });
  it('not enrolled', async () => {
    expect((await make({ enrolled: false }).status({ userId: 'test-learner' })).enrolled).toBe(false);
  });
  it('offers yesterday late only when owed and not done', async () => {
    expect(await make().lateDayOffered('test-learner')).toBe('2026-10-20');               // Tue owed, empty
    expect(await make({ days: { '2026-10-20': done } }).lateDayOffered('test-learner')).toBeNull();
    expect(await make({ now: '2026-10-20T22:00:00Z' }).lateDayOffered('test-learner')).toBeNull(); // Mon 19th is in except
    expect(await make({ now: '2026-10-25T22:00:00Z' }).lateDayOffered('test-learner')).toBeNull(); // Sat 24th not a weekday
    expect(await make({ now: '2026-10-24T22:00:00Z' }).lateDayOffered('test-learner')).toBe('2026-10-23'); // Friday's grace is Saturday
  });
  it('household calendar day off is not owed', async () => {
    const l = make({ household: { except: [{ from: '2026-10-20', to: '2026-10-20' }] } });
    expect(await l.lateDayOffered('test-learner')).toBeNull();
  });
  it('launch target carries a grant for today and the late day', async () => {
    const t = await make().issueLaunchTarget({ userId: 'test-learner', unitId: 'school-debrief:daily' });
    expect(t).toEqual({ kind: 'program', program: 'school-debrief', learnerId: 'test-learner', debriefGrant: 'grant:test-learner:2026-10-21,2026-10-20', today: '2026-10-21', lateDay: '2026-10-20' });
  });
  it('weekFacts: one row per owed day with timeliness and bonuses', async () => {
    const days = {
      '2026-10-20': [{ type: 'questions', substance: 8, questions: [{ id: 'q1', kind: 'choice', prompt: 'p', options: ['a', 'b', 'c'], answer: 'a' }], questioner: 'model', at: 'x' },
        { type: 'answer', questionId: 'q1', response: 'a', correct: true, at: 'y' }, { type: 'completed', at: 'z' }],
      '2026-10-21': [{ type: 'opened', late: true, at: 'x' }, { type: 'questions', substance: 9, questions: [], questioner: 'model', late: true, at: 'x' }, { type: 'completed', late: true, at: 'z' }],
    };
    const rows = await make({ days, now: '2026-10-22T22:00:00Z' }).weekFacts({ learnerId: 'test-learner', week: { from: '2026-10-19', to: '2026-10-25' }, quizPassRatio: 0.67, substantiveScore: 6 });
    expect(rows.map((r) => [r.day, r.state, r.timeliness, r.substantive, r.quizPassed])).toEqual([
      ['2026-10-20', 'completed', 'on-time', true, true],
      ['2026-10-21', 'completed', 'late', false, false],
      ['2026-10-22', 'open', 'on-time', false, false],
      ['2026-10-23', 'open', 'on-time', false, false],
    ]);
  });
});
