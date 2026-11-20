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
    expect(s.ledger).toEqual({ asked: true, lessons: 2, programsDone: [], needsLesson: true, needsPrograms: [], makeupClaims: [] });
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

  // 2026-11-19: a learner's Wednesday worksheet, reprinted from the makeup
  // sheet and passed Thursday, must not be Thursday's math.
  it('a claimed pass is not the day\'s own lesson; the ledger names the day it is for', () => {
    const entries = [math(1, 'completed'), math(2, 'available')];
    const claimed = {
      ...pass('m-1', `${THURSDAY}T18:18:21.000Z`),
      makeupFor: '2026-11-18', makeupDeadline: SATURDAY,
    };
    const s = section(entries, THURSDAY, [claimed]);
    expect(s.servedToday).toBe(false);
    expect(s.obligation.state).toBe('obligated');
    expect(s.next?.unitId).toBe('m-2');
    expect(s.ledger).toMatchObject({ lessons: 0, makeupClaims: ['2026-11-18'] });
  });

  it('an unclaimed pass the same day still serves it', () => {
    const entries = [math(1, 'completed'), math(2, 'completed'), math(3, 'available')];
    const claimed = { ...pass('m-1', `${THURSDAY}T16:00:00.000Z`), makeupFor: '2026-11-18', makeupDeadline: SATURDAY };
    const s = section(entries, THURSDAY, [claimed, pass('m-2', `${THURSDAY}T17:00:00.000Z`)]);
    expect(s.obligation.state).toBe('served');
    expect(s.ledger).toMatchObject({ lessons: 1, makeupClaims: ['2026-11-18'] });
  });

  it('a claim past its deadline counts for the day it was done', () => {
    const entries = [math(1, 'completed'), math(2, 'available')];
    const late = { ...pass('m-1', `${THURSDAY}T18:00:00.000Z`), makeupFor: '2026-11-18', makeupDeadline: '2026-11-18' };
    expect(section(entries, THURSDAY, [late]).obligation.state).toBe('served');
  });
});
