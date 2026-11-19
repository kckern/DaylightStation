import { describe, expect, it } from 'vitest';
import { planDailyAgenda } from "./agenda.mjs";

// The per-section ledger `domain/makeup.mjs` reads: what a day's required work
// in the section amounted to, by track, and whether the calendar asked for it.
const math = (n, status, over = {}) => ({
  unitId: `m-${n}`, title: `Math ${n}`, subject: 'math', courseId: 'em', sequence: n,
  program: null, elective: false, status, schedule: { daysOfWeek: [1, 2, 3, 4, 5] }, ...over,
});
const pass = (unitId, at) => ({
  sessionId: `s-${unitId}`, unitId, state: 'closed', terminal: true, updatedAt: at,
  outcome: { result: 'passed', at },
});
const section = (entries, day, sessions = []) => planDailyAgenda({
  plan: { entries }, sessions, now: `${day}T18:00:00.000Z`,
}).sections.find((s) => s.subject === 'math');

const THURSDAY = '2026-11-19';
const SATURDAY = '2026-11-21';

describe('agenda section makeup ledger', () => {
  it('counts every required lesson passed today on an asked day', () => {
    const entries = [math(1, 'completed'), math(2, 'completed'), math(3, 'available')];
    const s = section(entries, THURSDAY, [pass('m-1', `${THURSDAY}T16:00:00.000Z`), pass('m-2', `${THURSDAY}T17:00:00.000Z`)]);
    expect(s.ledger).toEqual({ asked: true, lessons: 2, programsDone: [], needsLesson: true, needsPrograms: [] });
  });

  it('a Saturday the course does not meet is not asked, even when worked', () => {
    const entries = [math(1, 'completed'), math(2, 'available')];
    const s = section(entries, SATURDAY, [pass('m-1', `${SATURDAY}T17:00:00.000Z`)]);
    expect(s.obligation.state).toBe('served');
    expect(s.ledger).toMatchObject({ asked: false, lessons: 1 });
  });

  it('an elective pass is not counted', () => {
    const entries = [math(1, 'available'), math(9, 'completed', { elective: true })];
    const s = section(entries, THURSDAY, [pass('m-9', `${THURSDAY}T17:00:00.000Z`)]);
    expect(s.ledger.lessons).toBe(0);
  });
});
