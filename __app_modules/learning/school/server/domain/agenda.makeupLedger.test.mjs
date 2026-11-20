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

// Review, 2026-11-19: a claimed pass must survive every filter that decides
// what the day still asks for, or its claim vanishes with it while the day
// it was done on has already given the lesson up.
describe('a claimed pass survives the day-off filters', () => {
  const base = { elective: false, status: 'completed', program: null, timingPriority: 3, timingRank: 0 };
  const WEDNESDAY = '2026-11-11';
  const claimedPass = (unitId) => ({
    ...pass(unitId, `${WEDNESDAY}T17:00:00.000Z`), makeupFor: '2026-11-10', makeupDeadline: '2026-11-14',
  });
  const build = (entries, span, sessions) => planDailyAgenda({
    plan: { entries }, sessions, now: `${WEDNESDAY}T18:00:00.000Z`,
    programStatuses: { 'book-log::shelf': { doneToday: false } },
    householdSchedule: { except: [{ from: WEDNESDAY, to: WEDNESDAY, label: 'Veterans Day', ...span }] },
  });

  it('an enrichment swap keeps the claimed lesson in the ledger', () => {
    const civ = { ...base, unitId: 'civ-1', title: 'States', subject: 'civilization', courseId: 'civ' };
    const hol = {
      ...base, status: 'available', unitId: 'hol', title: 'Veterans Day', subject: 'civilization', courseId: 'civ',
      dateBound: { onDays: [{ from: WEDNESDAY, to: WEDNESDAY }] },
    };
    const agenda = build([civ, hol], { tier: 'enrichment', replaces: 'civilization', assignment: 'hol' }, [claimedPass('civ-1')]);
    const s = agenda.sections.find((x) => x.subject === 'civilization');
    expect(s.ledger.makeupClaims).toEqual(['2026-11-10']);
    expect(s.next?.unitId).toBe('hol');
  });

  it('a keeping tier keeps the claimed lesson in the ledger', () => {
    const lesson = { ...base, unitId: 'eng-1', title: 'Nouns', subject: 'english', courseId: 'eng' };
    const shelf = {
      ...base, status: 'available', unitId: 'book-log:shelf', subject: 'english', program: 'book-log',
      programInstance: 'shelf', cadence: 'daily',
    };
    const agenda = build([lesson, shelf], { tier: 'stay-home' }, [claimedPass('eng-1')]);
    const s = agenda.sections.find((x) => x.subject === 'english');
    expect(s.ledger.makeupClaims).toEqual(['2026-11-10']);
  });
});
