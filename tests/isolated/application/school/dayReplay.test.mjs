/**
 * The past-day replay seam (plan: 2026-09-09 school board + reading surfaces,
 * Stream 1). Evidence is filtered by time; config is not.
 *
 * Each test here would FAIL without the seam: the pre-seam projection read
 * the learner's whole history for any instant and every launcher's live
 * answer, so a Thursday pass coloured Tuesday and a flashcard deck's mastery
 * today described every day of the term.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GetLearnerDayCompletion } from '#apps/school/GetLearnerDayCompletion.mjs';
import { PlanProjection } from '#apps/school/PlanProjection.mjs';
import { collectProgramStatuses, UNKNOWABLE_STATUS } from '#apps/school/programStatusCollection.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT } from '#testlib/school/lifecycleFixtures.mjs';

const LEARNER = 'kid1';
// The fixture clock's Monday. Study days are UTC here (timezone null).
const MON = '2026-07-27';
const TUE = '2026-07-28';
const THU = '2026-07-30';

let clock, sessions, assignments, curriculum;

function build({ courses = ['math-fractions'], programs = [], launchers = new Map(), attestations = null, exceptions = null, householdSchedule = null } = {}) {
  clock = fakeClock('2026-07-31T12:00:00.000Z'); // Friday noon — every day above is past
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, programIds: () => [...launchers.keys()], clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore([{ learnerId: LEARNER, courses, programs }]);
  const planProjection = new PlanProjection({
    curriculum, assignments, sessions, launchers, attestations, curriculumExceptions: exceptions,
    timezone: null, clock: clock.now, logger: silentLogger, householdSchedule,
  });
  const completion = new GetLearnerDayCompletion({
    curriculum, assignments, sessions, launchers, timezone: null, clock: clock.now, planProjection, logger: silentLogger,
  });
  return { planProjection, completion };
}

async function pass(unitId, atIso, sessionId = `ses_${unitId}`) {
  const base = { sessionId, learnerId: LEARNER, unitId };
  await sessions.appendEvent(sessionId, { type: 'created', at: atIso, ...base, studyDay: atIso.slice(0, 10) });
  await sessions.appendEvent(sessionId, { type: 'issued', at: atIso, sessionId, artifactId: `art_${sessionId}` });
  await sessions.appendEvent(sessionId, { type: 'submitted', at: atIso, sessionId, transport: 'paper' });
  await sessions.appendEvent(sessionId, { type: 'graded', at: atIso, sessionId, attemptIds: ['att_1'], percent: 90 });
  await sessions.appendEvent(sessionId, { type: 'outcome_recorded', at: atIso, sessionId, outcomeId: `out_${sessionId}`, result: 'passed' });
  return sessionId;
}

const mathSection = (r) => r.sections.find((s) => s.subject === 'math');

describe('past-day replay: sessions', () => {
  let completion;
  beforeEach(() => { ({ completion } = build()); });

  it('a session passed on Thursday is absent from Tuesday, and Tuesday reads incomplete', async () => {
    await pass(MEDIA_UNIT, `${THU}T15:00:00.000Z`);
    const tuesday = await completion.execute({ learnerId: LEARNER, studyDay: TUE });
    expect(tuesday.replayed).toBe(true);
    expect(tuesday.studyDate).toBe(TUE);
    expect(tuesday.state).toBe('incomplete');
    // …and Thursday itself is complete on the same evidence.
    const thursday = await completion.execute({ learnerId: LEARNER, studyDay: THU });
    expect(thursday.state).toBe('complete');
    expect(mathSection(thursday).state).toBe('served');
  });

  it("the unit passed later still reads as the day's AVAILABLE work, not locked or done", async () => {
    await pass(MEDIA_UNIT, `${THU}T15:00:00.000Z`);
    const { planProjection } = build();
    await pass(MEDIA_UNIT, `${THU}T15:00:00.000Z`);
    const { plan } = await planProjection.project({
      learnerId: LEARNER, now: `${TUE}T12:00:00.000Z`, historyUntil: `${TUE}T23:59:59.999Z`, day: TUE,
    });
    expect(plan.entries.find((e) => e.unitId === MEDIA_UNIT).status).toBe('available');
    expect(plan.entries.find((e) => e.unitId === WORKSHEET_UNIT).status).toBe('locked');
  });

  it('a grade annotation after the day does not move the outcome stamp — the pass stays on its day', async () => {
    const sid = await pass(MEDIA_UNIT, `${TUE}T15:00:00.000Z`);
    // A teacher touches the grade two days later.
    await sessions.appendEvent(sid, { type: 'graded', at: `${THU}T09:00:00.000Z`, sessionId: sid, attemptIds: ['att_2'], percent: 95 });
    const rows = await sessions.listForLearner(LEARNER);
    expect(rows[0].outcome.at).toBe(`${TUE}T15:00:00.000Z`);
    expect(rows[0].updatedAt).toBe(`${THU}T09:00:00.000Z`);
    const tuesday = await completion.execute({ learnerId: LEARNER, studyDay: TUE });
    expect(tuesday.state).toBe('complete');
  });

  it('today (no studyDay) is unchanged: whole history, not replayed', async () => {
    await pass(MEDIA_UNIT, `${THU}T15:00:00.000Z`);
    const today = await completion.execute({ learnerId: LEARNER });
    expect(today.replayed).toBe(false);
    expect(today.state).toBe('incomplete'); // Friday: the Thursday pass served Thursday, not Friday
  });

  it('refuses a malformed study day rather than answering for today under its name', async () => {
    await expect(completion.execute({ learnerId: LEARNER, studyDay: '2026-13-40' })).rejects.toThrow(/invalid studyDay/);
  });
});

describe('past-day replay: overlays', () => {
  it('an attestation dated after the day unlocks nothing on that day', async () => {
    const attestations = { list: () => [{ id: 'att1', unitId: MEDIA_UNIT, at: `${THU}T08:00:00.000Z` }] };
    const { planProjection } = build({ attestations });
    const { plan } = await planProjection.project({
      learnerId: LEARNER, now: `${TUE}T12:00:00.000Z`, historyUntil: `${TUE}T23:59:59.999Z`, day: TUE,
    });
    expect(plan.entries.find((e) => e.unitId === WORKSHEET_UNIT).status).toBe('locked');
    const live = await planProjection.project({ learnerId: LEARNER });
    expect(live.plan.entries.find((e) => e.unitId === WORKSHEET_UNIT).status).not.toBe('locked');
  });

  it('asks the exception store AS OF the day, not for the current set', async () => {
    const asked = [];
    const exceptions = {
      active: async () => { asked.push('active'); return []; },
      activeAsOf: async (until) => { asked.push(until); return []; },
    };
    const { planProjection } = build({ exceptions });
    await planProjection.project({ learnerId: LEARNER, now: `${TUE}T12:00:00.000Z`, historyUntil: `${TUE}T23:59:59.999Z`, day: TUE });
    expect(asked).toEqual([`${TUE}T23:59:59.999Z`]);
  });
});

describe('past-day replay: program launchers', () => {
  const launcher = ({ replayable, seen }) => ({
    id: 'p', entryAction: null, surface: null, replayable,
    async status(args) { seen.push(args); return { doneToday: true, progressLabel: null, score: null }; },
    async launch() { return { decision: 'failed', message: '' }; },
  });

  it('a non-replayable launcher is NEVER called with a day and reads unknowable', async () => {
    const seen = [];
    const launchers = new Map([['p', launcher({ replayable: false, seen })]]);
    const plan = { entries: [{ unitId: 'p:x', program: 'p', programInstance: null }] };
    const statuses = await collectProgramStatuses({ plan, learnerId: LEARNER, launchers, logger: silentLogger, day: TUE });
    expect(seen).toEqual([]);
    expect(statuses[0].status).toEqual(UNKNOWABLE_STATUS);
    // Live it is still asked, without a day.
    await collectProgramStatuses({ plan, learnerId: LEARNER, launchers, logger: silentLogger });
    expect(seen).toEqual([{ userId: LEARNER, programInstance: null }]);
  });

  it('a replayable launcher is asked for the day', async () => {
    const seen = [];
    const launchers = new Map([['p', launcher({ replayable: true, seen })]]);
    const plan = { entries: [{ unitId: 'p:x', program: 'p', programInstance: 'i' }] };
    await collectProgramStatuses({ plan, learnerId: LEARNER, launchers, logger: silentLogger, day: TUE });
    expect(seen).toEqual([{ userId: LEARNER, programInstance: 'i', day: TUE }]);
  });

  it("a learner whose only work is a non-replayable program reads excused: no_history on a past day — never no_work_today's blue", async () => {
    const launchers = new Map([['flashcards', {
      id: 'flashcards', entryAction: null, surface: null, replayable: false,
      async status() { return { doneToday: true, progressLabel: null, score: null }; },
      async launch() { return { decision: 'failed', message: '' }; },
    }]]);
    const { completion } = build({
      courses: [], launchers,
      programs: [{ programId: 'flashcards', subject: 'language', title: 'Cards', deckId: 'd1' }],
    });
    const tuesday = await completion.execute({ learnerId: LEARNER, studyDay: TUE });
    // `flashcards` is not one of the nine shelves; the agenda files it under `other`.
    const section = tuesday.sections.find((s) => s.subject === 'other');
    expect(section).toMatchObject({ state: 'excused', reason: 'no_history', unknowable: true });
    expect(tuesday.state).toBe('no_work_today');
    expect(tuesday.excused).toEqual([{ subject: 'other', reason: 'no_history' }]);
    // Live, the same learner is asked and served — the deck answered doneToday.
    const today = await completion.execute({ learnerId: LEARNER });
    expect(today.state).toBe('complete');
  });
});

describe('household calendar', () => {
  it('a day the house declared off excuses every section as household_calendar', async () => {
    const { completion } = build({ householdSchedule: { except: [{ from: MON, to: TUE }] } });
    const tuesday = await completion.execute({ learnerId: LEARNER, studyDay: TUE });
    expect(mathSection(tuesday)).toMatchObject({ state: 'excused', reason: 'household_calendar' });
    const thursday = await completion.execute({ learnerId: LEARNER, studyDay: THU });
    expect(mathSection(thursday).state).toBe('obligated');
  });

  it('work done on a day off still reads served — the calendar never un-serves', async () => {
    const { completion } = build({ householdSchedule: { except: [TUE] } });
    await pass(MEDIA_UNIT, `${TUE}T15:00:00.000Z`);
    const tuesday = await completion.execute({ learnerId: LEARNER, studyDay: TUE });
    expect(mathSection(tuesday).state).toBe('served');
  });
});
