/**
 * The teacher-console journey (goal addition, plan W5-5): a fake household
 * student enrolls in the Pokemon course through the TEACHER write path,
 * takes the printed quiz through the VIRTUAL OMR reader (real form map,
 * real grading engine — no hardware), and every teacher-side read then
 * tells the truth about it: the today digest, the report card, milestone
 * pacing, and the attempt evidence itself.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { createLifecycleHarness } from '../../../_lib/school/lifecycleHarness.mjs';
import { fixtureBank } from '../../../_lib/school/lifecycleFixtures.mjs';
import { GetTeacherToday } from '#apps/school/usecases/GetTeacherToday.mjs';
import { GetReportCard } from '#apps/school/usecases/GetReportCard.mjs';
import { GetMilestoneStatuses } from '#apps/school/usecases/GetMilestoneStatuses.mjs';
import { YamlMilestoneStore } from '#adapters/persistence/yaml/YamlMilestoneStore.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';

const POKEMON_COURSE = 'pokemon-basics';
const POKEMON_UNIT = 'pokemon-basics.01';
const POKEMON_BANK = 'science/pokemon-basics/01-quiz';
const ASH = 'ash';
const TEACHER = 'grownup1';

const ROSTER = [
  { id: ASH, name: 'Ash', birthyear: 2015 },
  { id: 'misty', name: 'Misty', birthyear: 2017 },
  { id: TEACHER, name: 'Professor Oak', birthyear: 1980 },
];

describe('fake student → Pokemon course → virtual OMR → results → teacher view', () => {
  let h;

  beforeAll(async () => {
    h = await createLifecycleHarness({ roster: ROSTER, startIso: '2026-08-06T16:00:00.000Z' });
  });

  it('runs the lifecycle on the production composition; teacher views on the same classes app.mjs wires', async () => {
    // --- the TEACHER enrolls the student (the console's own write path) -----
    const enrolled = await h.useCases.setAssignments.execute({
      learnerId: ASH, courses: [POKEMON_COURSE], units: [], assignedBy: TEACHER,
    });
    // Storage boundary normalizes shorthand course-id strings to enrollment
    // records (bfdbe7598, YamlAssignmentStore#normalizeEnrollment) — every
    // other assignments test in the suite (lifecycleStores, EnrollLearner,
    // IssueComposedWorksheet, parentWrites) already asserts the object shape.
    expect(enrolled.courses).toEqual([{ courseId: POKEMON_COURSE }]);

    // --- the student taps their card; the agenda offers the course ----------
    const scan = await h.as(ASH).scanCard();
    expect(scan.status).toBe('agenda_printed');
    const tape = h.lastReceiptText();
    expect(tape).toMatch(/ASH/i); // the header band prints the name uppercased
    expect(tape).toMatch(/Pokemon Basics/i);

    // --- scanning the science ticket prints the OMR quiz sheet --------------
    const issued = await h.scanTokenMatching(/Pokemon Basics/i);
    expect(issued.status).toBe('issued');
    const sessionId = issued.sessionId;
    const formMap = await h.formMapFor(sessionId);
    expect(formMap.documentId).toBe('pokemon-basics-01-omr');
    expect(formMap.marks).toHaveLength(24); // six questions x four bubbles

    // --- the student bubbles 5 of 6 right; the VIRTUAL reader reads the paper
    const chosen = await h.correctBubbles({ sessionId, bankId: POKEMON_BANK, wrong: ['pk-q4'] });
    const submitted = await h.omrSubmit(chosen, { sessionId, submittedBy: TEACHER });
    expect(submitted.status).toBe('submitted');
    expect(submitted.review).toEqual([]); // machine marks need no human

    const graded = await h.grade({ sessionId, entries: submitted.scorable, gradedBy: TEACHER });
    expect(graded.status).toBe('graded');
    expect(graded.correct).toBe(5);
    expect(graded.percent).toBe(83.33); // 5/6, above the 80 bar

    const closed = await h.closeOutcome({ sessionId });
    expect(closed.result).toBe('passed');

    // --- RESULTS: the one grading engine recorded real, attributed evidence -
    const attempts = h.attemptsFor(ASH).filter((a) => a.bankId === POKEMON_BANK);
    expect(attempts).toHaveLength(6);
    expect(attempts.every((a) => a.attributedTo === ASH && a.transport === 'paper')).toBe(true);
    expect(attempts.filter((a) => a.correct).length).toBe(5);
    const bank = fixtureBank(POKEMON_BANK);
    expect(new Set(attempts.map((a) => a.itemId))).toEqual(new Set(bank.items.map((i) => i.id)));

    // --- TEACHER VIEW 1: the today digest (the console's roster strip) ------
    // Honesty note (M5 review): the teacher-view reads below construct the
    // SAME use-case classes app.mjs wires, but with hand-shimmed config /
    // directory / periods — app.mjs's own teacher-read wiring is covered by
    // the route-level suites, not here.
    const teacherViewDatastore = new YamlSchoolDatastore({
      configService: {
        getDataDir: () => h.dataDir,
        getUserDir: (id) => path.join(h.dataDir, 'users', String(id)),
        getUserProfile: (id) => ROSTER.find((r) => r.id === id) ?? null,
        getHouseholdPath: (rel) => path.join(h.dataDir, 'household', rel),
      },
    });
    const learnerDirectory = {
      listLearners: async () => ROSTER.filter((r) => r.birthyear > 2008).map(({ id, name }) => ({ id, name })),
    };
    const teacherToday = new GetTeacherToday({
      learnerDirectory,
      datastore: teacherViewDatastore,
      sessions: h.stores.sessions,
      reviewQueue: h.stores.reviewQueue,
      clock: () => h.clock.now(),
    });
    const digest = await teacherToday.execute();
    const ashRow = digest.find((r) => r.learnerId === ASH);
    expect(ashRow).toMatchObject({ attemptsToday: 6, correctToday: 5, pendingReview: 0 });
    expect(ashRow.sessionsToday.some((s) => s.unitId === POKEMON_UNIT)).toBe(true);
    // The sibling who did nothing shows a quiet zero row, not an absence.
    expect(digest.find((r) => r.learnerId === 'misty')).toMatchObject({ attemptsToday: 0 });

    // --- TEACHER VIEW 2: the report card (Records tab) ----------------------
    const periods = {
      listPeriods: () => [{
        schema: 'school.academic-period/v1', periodId: '2026-fall', kind: 'semester',
        label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z',
      }],
      getPeriod: (id) => (id === '2026-fall' ? {
        schema: 'school.academic-period/v1', periodId: '2026-fall', kind: 'semester',
        label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z',
      } : null),
    };
    const reportCard = new GetReportCard({
      curriculum: h.lifecycle.stores.curriculum ?? h.stores.curriculum,
      assignments: h.stores.assignments,
      sessions: h.stores.sessions,
      datastore: teacherViewDatastore,
      academicPeriods: periods,
      clock: () => h.clock.now(),
    });
    const card = await reportCard.execute({ learnerId: ASH, periodId: '2026-fall' });
    const course = card.courses.find((c) => c.courseId === POKEMON_COURSE);
    expect(course).toBeTruthy();
    expect(course.coursePercent).toBeCloseTo(83.33, 1);
    expect(course.unitGrades.find((u) => u.unitId === POKEMON_UNIT)).toMatchObject({ passed: true, bestPercent: 83.33 });
    expect(card.activeDays.total).toBeGreaterThanOrEqual(1);

    // --- TEACHER VIEW 3: milestone pacing — the passed unit reads met -------
    const milestoneStore = new YamlMilestoneStore({
      configService: { getHouseholdPath: (rel) => path.join(h.dataDir, 'household', rel) },
    });
    await milestoneStore.replace([
      { id: 'm-pokemon', learnerId: ASH, courseId: POKEMON_COURSE, unitId: POKEMON_UNIT, dueBy: '2026-09-01' },
    ], { editedBy: TEACHER });
    const milestoneStatuses = new GetMilestoneStatuses({
      store: milestoneStore, sessions: h.stores.sessions, clock: () => h.clock.now(),
    });
    const { milestones } = await milestoneStatuses.execute({ learnerId: ASH });
    expect(milestones[0].status).toBe('met');
  }, 60_000);
});
