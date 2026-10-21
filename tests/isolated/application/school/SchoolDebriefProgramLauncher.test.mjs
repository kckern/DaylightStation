// tests/isolated/application/school/SchoolDebriefProgramLauncher.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { SchoolDebriefProgramLauncher } from "../../../../__app_modules/learning/school/server/application/SchoolDebriefProgramLauncher.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const SCHED = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-10-19', to: '2026-10-19' }] };
function make({ days = {}, enrolled = true, readThrows = false, now = '2026-10-21T22:00:00Z', household = null, logger = silent, donow = null, grants: g = undefined } = {}) {
  const debriefs = { read: async (_l, d) => { if (readThrows) return { status: 'unreadable', events: [] }; return { status: days[d] ? 'ok' : 'missing', events: days[d] ?? [] }; } };
  const assignments = { get: async () => ({ programs: enrolled ? [{ programId: 'school-debrief', corpusId: null, subject: 'writing', title: 'After-school debrief', schedule: SCHED }] : [] }) };
  const grants = { issue: ({ learnerId, days: d }) => `grant:${learnerId}:${d.join(',')}` };
  return new SchoolDebriefProgramLauncher({ debriefs, assignments, grants: g === undefined ? grants : g, householdSchedule: household, timezone: 'UTC', clock: () => new Date(now), logger, donow });
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
  it('a rejected day reads "Talk to a grown-up"', async () => {
    const s = await make({ days: { '2026-10-21': [...done, { type: 'rejected', at: 'z' }] } }).status({ userId: 'test-learner' });
    expect(s.progressLabel).toBe('Talk to a grown-up');
  });
  it('weekFacts: a fallback day never passes the quiz bonus, even with every answer right', async () => {
    const days = { '2026-10-20': [{ type: 'questions', substance: null, questions: [{ id: 'f1', kind: 'choice', prompt: 'p', options: ['a', 'b'], answer: 'a' }], questioner: 'fallback', at: 'x' },
      { type: 'answer', questionId: 'f1', response: 'a', correct: true, at: 'y' }, { type: 'completed', at: 'z' }] };
    const [row] = await make({ days }).weekFacts({ learnerId: 'test-learner', week: { from: '2026-10-20', to: '2026-10-20' }, quizPassRatio: 0.67, substantiveScore: 6 });
    expect(row).toMatchObject({ state: 'completed', quiz: { right: 1, graded: 1 }, quizPassed: false, substantive: false });
  });
  it('owedDays: the owed days in range, never past today; default is the last 14 owed days', async () => {
    const l = make();
    expect(await l.owedDays('test-learner', { from: '2026-10-16', to: '2026-10-30' })).toEqual(['2026-10-16', '2026-10-20', '2026-10-21']); // 17/18 weekend, 19 except
    const dflt = await l.owedDays('test-learner');
    expect(dflt).toHaveLength(14);
    expect(dflt.at(-1)).toBe('2026-10-21');
    expect(dflt).not.toContain('2026-10-19');
    expect(await make({ enrolled: false }).owedDays('test-learner')).toEqual([]);
  });
  it('launch logs why it failed and keeps the friendly answer', async () => {
    const logger = { info() {}, warn: vi.fn(), error() {}, debug() {} };
    const l = make({ logger, donow: { dispatch: vi.fn() }, grants: null });
    expect(await l.launch({ userId: 'test-learner' })).toEqual({ decision: 'failed', message: 'The debrief is not ready to open.' });
    expect(logger.warn).toHaveBeenCalledWith('school.debrief.launch-failed', { userId: 'test-learner', error: 'Debrief grants unavailable' });
  });
});
