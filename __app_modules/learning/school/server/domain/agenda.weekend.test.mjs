import { describe, expect, it } from 'vitest';
import { planDailyAgenda } from "./agenda.mjs";

const OPENS = { w1: '2026-11-02', w2: '2026-11-09', w3: '2026-11-16' };
const lesson = (module, day, status, over = {}) => ({
  unitId: `${module}-d${day}`, title: `${module} day ${day}`, subject: 'scripture', courseId: 'cfm',
  module, sequence: Number(module.slice(1)) * 10 + day, program: null, elective: false, status,
  timing: { mode: module === 'w1' ? 'catch_up' : 'dated' },
  timingState: module === 'w1' ? 'catch_up' : 'available',
  timingPriority: 2, timingRank: module === 'w1' ? 1 : 0,
  schedule: { daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
  weekendPolicy: 'backlog-then-review', moduleOpensOn: OPENS[module],
  ...over,
});
const week = (module, statuses) => statuses.map((status, index) => lesson(module, index + 1, status));
const pass = (unitId, at) => ({
  sessionId: `s-${unitId}-${at}`, unitId, state: 'closed', terminal: true, updatedAt: at,
  outcome: { result: 'passed', at },
});
const run = (entries, day, sessions = []) => planDailyAgenda({
  plan: { entries }, sessions, now: `${day}T18:00:00.000Z`,
}).sections.find((s) => s.subject === 'scripture');

const SATURDAY = '2026-11-14';
const SUNDAY = '2026-11-15';

describe('weekend scripture: backlog, then review, never advance', () => {
  it('offers the oldest undone lesson first on a Saturday', () => {
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
      ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
    ];
    const section = run(entries, SATURDAY);
    expect(section.next.unitId).toBe('w1-d4');
    expect(section.obligation.state).toBe('obligated');
  });

  it('with no backlog, re-sits the week\'s least recently passed lesson as a review', () => {
    const entries = [...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed'))];
    const sessions = [
      pass('w2-d1', '2026-11-09T18:00:00.000Z'), pass('w2-d2', '2026-11-12T18:00:00.000Z'),
      pass('w2-d3', '2026-11-11T18:00:00.000Z'), pass('w2-d4', '2026-11-10T17:00:00.000Z'),
      pass('w2-d5', '2026-11-13T18:00:00.000Z'), pass('w1-d1', '2026-11-02T18:00:00.000Z'),
      // An older re-pass of d4 does not make it older than its newest pass.
      pass('w2-d1', '2026-11-12T19:00:00.000Z'),
    ];
    const section = run(entries, SATURDAY, sessions);
    expect(section.next).toMatchObject({ unitId: 'w2-d4', review: true });
    expect(section.obligation.state).toBe('obligated');
  });

  it('a passed review re-sit serves Sunday', () => {
    const entries = [...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed'))];
    const sessions = [pass('w2-d3', '2026-11-11T18:00:00.000Z'), pass('w2-d3', `${SUNDAY}T17:00:00.000Z`)];
    const section = run(entries, SUNDAY, sessions);
    expect(section.obligation.state).toBe('served');
    expect(section.next).toBeNull();
  });

  it('never offers a lesson from a module that has not opened', () => {
    const entries = [
      ...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed')),
      lesson('w3', 1, 'available', { timingState: 'available' }),
    ];
    const section = run(entries, SATURDAY, [pass('w2-d1', '2026-11-09T18:00:00.000Z')]);
    expect(section.next.unitId).not.toBe('w3-d1');
    expect(section.next.review).toBe(true);
  });

  it('a weekday picks exactly what it picks without the policy', () => {
    const TUESDAY = '2026-11-10';
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
      ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
    ];
    const without = entries.map(({ weekendPolicy: _p, moduleOpensOn: _o, ...rest }) => rest);
    const withPolicy = run(entries, TUESDAY);
    const plain = run(without, TUESDAY);
    expect(withPolicy.next.unitId).toBe(plain.next.unitId);
    expect(withPolicy.obligation).toEqual(plain.obligation);
  });

  it('never makes a lesson on teacher hold the weekend item', () => {
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'in_progress', 'locked']),
      ...week('w2', Array(5).fill('completed')),
    ].map((e) => (e.unitId === 'w1-d4' ? { ...e, remediation: { held: true } } : e));
    const section = run(entries, SATURDAY, [pass('w2-d1', '2026-11-09T18:00:00.000Z')]);
    expect(section.next.unitId).not.toBe('w1-d4');
    expect(section.next.review).toBe(true);
  });

  it('with only held work and nothing to review, the weekend is not forced owed', () => {
    const entries = week('w2', ['in_progress', 'locked', 'locked', 'locked', 'locked'])
      .map((e) => (e.unitId === 'w2-d1' ? { ...e, remediation: { held: true } } : e));
    expect(run(entries, SATURDAY).obligation).toEqual({ state: 'excused', reason: 'teacher_hold' });
  });

  it('does not apply before the enrollment\'s weekendFrom day', () => {
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
      ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
    ].map(({ weekendPolicy: _p, ...rest }) => rest);
    // The planner drops the policy before weekendFrom; the agenda then picks as before.
    expect(run(entries, SATURDAY).next.unitId).toBe('w2-d2');
  });

  it('a weekend without the policy behaves as before', () => {
    const entries = week('w2', ['completed', 'available', 'locked', 'locked', 'locked'])
      .map(({ weekendPolicy: _p, ...rest }) => ({ ...rest, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } }));
    expect(run(entries, SATURDAY).obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });
});

describe('weekend scripture: the only thing on a weekend', () => {
  const weekdays = { daysOfWeek: [1, 2, 3, 4, 5] };
  const civics = (status = 'available') => ({
    unitId: 'civ-1', title: 'A state', subject: 'civilization', courseId: 'atlas', module: 'm1', sequence: 1,
    program: null, elective: false, status, timing: null, timingState: 'available', schedule: weekdays,
  });
  const piano = { unitId: 'piano-course:x', subject: 'arts', program: 'piano-course', programInstance: 'x',
    elective: false, status: 'available', timingState: 'available', schedule: weekdays, cadence: 'daily' };
  const debrief = { unitId: 'school-debrief:daily', subject: 'writing', program: 'school-debrief', programInstance: null,
    elective: false, status: 'available', timingState: 'available', schedule: weekdays, cadence: 'daily' };
  const statuses = [
    { programId: 'piano-course', programInstance: 'x', status: { doneToday: false } },
    { programId: 'school-debrief', programInstance: null, status: { doneToday: false } },
  ];
  const scripture = () => [
    ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
    ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
  ];
  const all = (entries, day, sessions = []) => planDailyAgenda({
    plan: { entries }, sessions, programStatuses: statuses, now: `${day}T18:00:00.000Z`,
  }).sections;
  const bySubject = (sections) => Object.fromEntries(sections.map((s) => [s.subject, s]));

  it('offers no other subject beside the weekend scripture item', () => {
    const s = bySubject(all([...scripture(), civics(), piano, debrief], SATURDAY));
    expect(s.scripture.next.unitId).toBe('w1-d4');
    expect(s.scripture.obligation.state).toBe('obligated');
    for (const subject of ['civilization', 'arts', 'writing']) {
      expect(s[subject].next).toBeNull();
      expect(s[subject].obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
      expect(s[subject].servedToday).toBe(false);
    }
  });

  it('stays scripture-only after the weekend item is done', () => {
    const sessions = [pass('w1-d4', `${SATURDAY}T17:00:00.000Z`)];
    const s = bySubject(all([...scripture(), civics(), piano], SATURDAY, sessions));
    expect(s.scripture.obligation.state).toBe('served');
    expect(s.civilization.next).toBeNull();
    expect(s.arts.next).toBeNull();
  });

  it('a learner without weekend scripture keeps the optional weekend offers', () => {
    const plain = scripture().map(({ weekendPolicy: _p, ...rest }) => ({ ...rest, schedule: weekdays }));
    const s = bySubject(all([...plain, civics(), piano], SATURDAY));
    expect(s.civilization.next.unitId).toBe('civ-1');
    expect(s.arts.next.unitId).toBe('piano-course:x');
    expect(s.civilization.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });

  it('an away weekend excuses scripture and keeps the old optional offers', () => {
    const calendar = { except: [{ from: SATURDAY, to: SATURDAY, label: 'Trip', tier: 'away' }] };
    const sections = planDailyAgenda({
      plan: { entries: [...scripture(), civics()] }, programStatuses: statuses,
      now: `${SATURDAY}T18:00:00.000Z`, householdSchedule: calendar,
    }).sections;
    const s = bySubject(sections);
    expect(s.scripture.obligation).toEqual({ state: 'excused', reason: 'household_calendar' });
    expect(s.civilization.next.unitId).toBe('civ-1');
  });

  it('a weekday is unchanged', () => {
    const s = bySubject(all([...scripture(), civics(), piano], '2026-11-10'));
    expect(s.civilization.next.unitId).toBe('civ-1');
    expect(s.arts.next.unitId).toBe('piano-course:x');
  });
});

describe('a program settled without play on a day that does not ask for it', () => {
  const weekdays = { daysOfWeek: [1, 2, 3, 4, 5] };
  const piano = { unitId: 'piano-course:x', subject: 'arts', program: 'piano-course', programInstance: 'x',
    elective: false, status: 'available', timingState: 'available', schedule: weekdays, cadence: 'daily' };
  const arts = (status, day) => planDailyAgenda({
    plan: { entries: [piano] },
    programStatuses: [{ programId: 'piano-course', programInstance: 'x', status }],
    now: `${day}T18:00:00.000Z`,
  }).sections.find((s) => s.subject === 'arts');

  it('a co-progress lock or day bypass on a Saturday is not counted as served', () => {
    const section = arts({ doneToday: true, excused: true, servedWork: [] }, SATURDAY);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });

  it('real play on a Saturday still counts', () => {
    const section = arts({ doneToday: true, servedWork: [{ unitId: 'l1', title: 'L1' }] }, SATURDAY);
    expect(section.obligation.state).toBe('served');
  });

  it('on a weekday the lock still settles the owed day', () => {
    const section = arts({ doneToday: true, excused: true, servedWork: [] }, '2026-11-10');
    expect(section.obligation.state).toBe('served');
  });
});


describe('Saturday catch-up: a missed weekday program comes back', () => {
  const weekdays = { daysOfWeek: [1, 2, 3, 4, 5] };
  const cards = { unitId: 'flashcards:x', subject: 'language', program: 'flashcards', programInstance: 'x',
    elective: false, status: 'available', timingState: 'available', schedule: weekdays, cadence: 'daily' };
  const civics = { unitId: 'civ-1', title: 'A state', subject: 'civilization', courseId: 'atlas', module: 'm1', sequence: 1,
    program: null, elective: false, status: 'available', timing: null, timingState: 'available', schedule: weekdays };
  const cardStatus = (doneOn) => [{ programId: 'flashcards', programInstance: 'x',
    status: { doneToday: false, ...(doneOn ? { weekdays: { weekFrom: '2026-11-09', doneOn } } : {}) } }];
  const scripture = () => [
    ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
    ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
  ];
  const scriptureDone = [pass('w1-d4', `${SATURDAY}T15:00:00.000Z`)];
  const MISSED_MONDAY = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  const build = ({ entries, day = SATURDAY, sessions = [], doneOn = MISSED_MONDAY, householdSchedule = null, programStatuses = null }) =>
    Object.fromEntries(planDailyAgenda({
      plan: { entries }, sessions, programStatuses: programStatuses ?? cardStatus(doneOn), now: `${day}T18:00:00.000Z`, householdSchedule,
    }).sections.map((s) => [s.subject, s]));
  const ALL_WEEK = ['2026-11-09', ...MISSED_MONDAY];
  const story = { unitId: 'story-time:daily', title: 'Story time', subject: 'language', program: 'story-time', programInstance: null,
    elective: false, status: 'available', timingState: 'available', schedule: weekdays, cadence: 'daily', timingPriority: 2 };
  const statusRow = (programId, programInstance, doneOn, extra = {}) => ({ programId, programInstance,
    status: { doneToday: false, weekdays: { weekFrom: '2026-11-09', doneOn }, ...extra } });

  it('after the weekend item, offers the program with its missed days, labelled catch-up, never owed', () => {
    const s = build({ entries: [...scripture(), cards, civics], sessions: scriptureDone });
    expect(s.scripture.obligation.state).toBe('served');
    expect(s.language.next.unitId).toBe('flashcards:x');
    expect(s.language.catchUp).toBe(true);
    expect(s.language.backfill).toEqual({ missedDays: ['2026-11-09'] });
    expect(s.language.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
    expect(s.civilization.next).toBeNull();
    expect(s.civilization.backfill).toBeNull();
  });
  it('before the weekend item is done, scripture stays the whole day', () => {
    const s = build({ entries: [...scripture(), cards] });
    expect(s.language.next).toBeNull();
    expect(s.language.catchUp).toBe(false);
    expect(s.language.backfill).toBeNull();
  });
  it('nothing missed, nothing offered', () => {
    const all = ['2026-11-09', ...MISSED_MONDAY];
    const s = build({ entries: [...scripture(), cards], sessions: scriptureDone, doneOn: all });
    expect(s.language.next).toBeNull();
    expect(s.language.backfill).toBeNull();
  });
  it('no replayed week, no offer', () => {
    const s = build({ entries: [...scripture(), cards], sessions: scriptureDone, doneOn: null });
    expect(s.language.next).toBeNull();
  });
  it('Sunday stays scripture-only', () => {
    const sunday = '2026-11-15';
    const s = build({ entries: [...scripture(), cards], day: sunday, sessions: [pass('w1-d4', `${sunday}T15:00:00.000Z`)] });
    expect(s.language.next).toBeNull();
    expect(s.language.backfill).toBeNull();
  });
  it('without weekend scripture the Saturday offer gains the catch-up label', () => {
    const s = build({ entries: [cards] });
    expect(s.language.next.unitId).toBe('flashcards:x');
    expect(s.language.catchUp).toBe(true);
    expect(s.language.backfill).toEqual({ missedDays: ['2026-11-09'] });
  });
  it('an away Monday is not a missed day', () => {
    const householdSchedule = { except: [{ from: '2026-11-09', to: '2026-11-09', label: 'Trip', tier: 'away' }] };
    const s = build({ entries: [...scripture(), cards], sessions: scriptureDone, householdSchedule });
    expect(s.language.next).toBeNull();
    expect(s.language.backfill).toBeNull();
  });

  it('a missed program wins over an in-progress lesson in the same subject', () => {
    const grammar = { unitId: 'gram-3', title: 'Grammar 3', subject: 'language', courseId: 'gram', module: 'm1', sequence: 3,
      program: null, elective: false, status: 'in_progress', timing: null, timingState: 'available', schedule: weekdays };
    const s = build({ entries: [...scripture(), grammar, cards], sessions: scriptureDone });
    expect(s.language.next.unitId).toBe('flashcards:x');
    expect(s.language.catchUp).toBe(true);
    expect(s.language.backfill).toEqual({ missedDays: ['2026-11-09'] });
    expect(s.language.obligation.state).toBe('excused');
  });
  it('two programs, only the second missed: the second is offered', () => {
    const first = { ...cards, timingPriority: 1 };
    const s = build({
      entries: [...scripture(), first, story], sessions: scriptureDone,
      programStatuses: [statusRow('flashcards', 'x', ALL_WEEK), statusRow('story-time', null, MISSED_MONDAY)],
    });
    expect(s.language.next.unitId).toBe('story-time:daily');
    expect(s.language.backfill).toEqual({ missedDays: ['2026-11-09'] });
    expect(s.language.pendingPrograms).toEqual([]);
  });
  it('both missed: the first by priority is next, the other is pending', () => {
    const first = { ...cards, timingPriority: 1, title: 'Cards' };
    const s = build({
      entries: [...scripture(), story, first], sessions: scriptureDone,
      programStatuses: [
        statusRow('flashcards', 'x', MISSED_MONDAY),
        statusRow('story-time', null, ['2026-11-09', '2026-11-10'], { obligationProgress: { completed: 0, total: 1 } }),
      ],
    });
    expect(s.language.next.unitId).toBe('flashcards:x');
    expect(s.language.backfill).toEqual({ missedDays: ['2026-11-09'] });
    expect(s.language.pendingPrograms).toEqual([{
      unitId: 'story-time:daily', program: 'story-time', programInstance: null, title: 'Story time',
      subject: 'language', obligationProgress: { completed: 0, total: 1 },
    }]);
  });
  it('before the weekend item is done, a second missed program is not pending either', () => {
    const s = build({
      entries: [...scripture(), story, cards],
      programStatuses: [statusRow('flashcards', 'x', MISSED_MONDAY), statusRow('story-time', null, MISSED_MONDAY)],
    });
    expect(s.language.next).toBeNull();
    expect(s.language.pendingPrograms).toEqual([]);
  });
  it('an elective program is never backfilled', () => {
    const s = build({ entries: [...scripture(), { ...cards, elective: true }], sessions: scriptureDone });
    expect(s.language.backfill).toBeNull();
    expect(s.language.next).toBeNull();
  });
  it('a once-only program is never backfilled', () => {
    const s = build({ entries: [...scripture(), { ...cards, cadence: 'once' }], sessions: scriptureDone });
    expect(s.language.backfill).toBeNull();
    expect(s.language.next).toBeNull();
  });
  it('a faulted weekend item is not settled: no catch-up beside it', () => {
    const scriptureProgram = { unitId: 'scrip:daily', title: 'Verses', subject: 'scripture', program: 'verses', programInstance: null,
      elective: false, status: 'available', timingState: 'available', schedule: { daysOfWeek: [1, 2, 3, 4, 5, 6, 7] } };
    const s = build({
      entries: [...scripture(), scriptureProgram, cards], sessions: scriptureDone,
      programStatuses: [...cardStatus(MISSED_MONDAY), { programId: 'verses', programInstance: null, status: { error: true } }],
    });
    expect(s.scripture.obligation.state).toBe('faulted');
    expect(s.language.next).toBeNull();
    expect(s.language.backfill).toBeNull();
  });
});
