import { describe, it, expect, vi } from 'vitest';
import { GetTeacherToday } from "./GetTeacherToday.mjs";
import { schoolArtifactRef } from '#apps/common/resources/publicResourceRefs.mjs';
import { PlanProjection } from "../PlanProjection.mjs";
import { FakeSessionRepository } from "../../../../../../tests/_lib/school/lifecycleFakes.mjs";

const events = [
  { type: 'created', at: '2026-08-23T15:00:00.000Z', sessionId: 'ses_learner4', seq: 1,
    learnerId: 'learner4', unitId: 'lesson-1', studyDay: '2026-08-23' },
  { type: 'issued', at: '2026-08-23T15:01:00.000Z', sessionId: 'ses_learner4', seq: 2, artifactId: 'art_1' },
  { type: 'submitted', at: '2026-08-24T16:00:00.000Z', sessionId: 'ses_learner4', seq: 3, transport: 'paper' },
  { type: 'graded', at: '2026-08-24T16:01:00.000Z', sessionId: 'ses_learner4', seq: 4,
    attemptIds: ['att_1', 'att_2'], percent: 50, passingPercent: 80, correctCount: 1, totalCount: 2 },
  { type: 'result_receipt_captured', at: '2026-08-24T16:02:00.000Z', sessionId: 'ses_learner4', seq: 5,
    artifactId: 'receipt_1', kind: 'result-receipt', printed: true },
];

function useCase(overrides = {}) {
  return new GetTeacherToday({
    learnerDirectory: { listLearners: async () => [{ id: 'learner4', name: 'Learner4' }] },
    datastore: { readAttemptDay: () => [] },
    sessions: {
      listForLearner: async () => [{ sessionId: 'ses_learner4', updatedAt: events.at(-1).at }],
      readEvents: async () => events,
    },
    curriculum: {
      listUnits: async () => [{ unitId: 'lesson-1', title: 'Lesson One', subject: 'math', courseId: 'course-1', module: 'unit-a' }],
      listWorks: async () => [{ work: 'course-1', title: 'Course One', subject: 'math', modules: [{ module: 'unit-a', title: 'Unit A' }] }],
    },
    timezone: 'UTC', boundaryHour: 4,
    clock: () => new Date('2026-08-24T18:00:00.000Z'), logger: { debug() {} },
    ...overrides,
  });
}

describe('GetTeacherToday v2', () => {
  it('keeps Learner4 work on August 23 and reports its August 24 scan once as processed today', async () => {
    const august23 = await useCase().execute({ studyDay: '2026-08-23', version: 'v2' });
    expect(august23.learners[0]).toMatchObject({
      effectiveScoreTotals: { correct: 1, total: 2, percent: 50 },
      sessions: [{ sessionId: 'ses_learner4', studyDay: '2026-08-23', lessonTitle: 'Lesson One', courseTitle: 'Course One', moduleTitle: 'Unit A' }],
      processedToday: [],
    });

    const august24 = await useCase().execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(august24.learners[0].sessions).toEqual([]);
    expect(august24.learners[0].effectiveScoreTotals).toEqual({ correct: 0, total: 0, percent: null });
    expect(august24.learners[0].processedToday).toHaveLength(1);
    expect(august24.learners[0].processedToday[0]).toMatchObject({
      sessionId: 'ses_learner4', studyDay: '2026-08-23', processedAt: '2026-08-24T16:01:00.000Z',
      processedEventTypes: ['submitted', 'graded'],
    });
  });

  it('carries the paper-record references the drill-in used to pay a per-session fetch for', async () => {
    const digest = await useCase().execute({ studyDay: '2026-08-23', version: 'v2' });
    expect(digest.learners[0].sessions[0].artifacts).toEqual({
      worksheet: {
        artifactId: 'art_1',
        originalPdfUrl: schoolArtifactRef('art_1', 'original.pdf'),
        thumbnailUrl: schoolArtifactRef('art_1', 'thumbnail.png'),
      },
      receipt: {
        artifactId: 'receipt_1',
        originalUrl: schoolArtifactRef('receipt_1', 'original'),
        printed: true,
        printReason: null,
        capturedAt: '2026-08-24T16:02:00.000Z',
      },
    });
    // The carried-over lane keeps the same references — the dashboard shows
    // yesterday's sheet scanned today without any extra fetch either.
    const august24 = await useCase().execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(august24.learners[0].processedToday[0].artifacts.worksheet.artifactId).toBe('art_1');
  });

  it('reads one persisted shelf per learner and projects activity on the requested study day', async () => {
    const bookLog = { listForLearner: vi.fn(async () => [{ itemId: 'learner4:b:open-1', events: [
      { kind: 'started', at: '2026-08-24T12:00:00.000Z' },
      { kind: 'progress', at: '2026-08-24T13:00:00.000Z', page: 25 },
      { kind: 'finished', at: '2026-08-24T14:00:00.000Z' },
    ] }]) };
    const digest = await useCase({ bookLog }).execute({ studyDay: '2026-08-24', version: 'v2' });

    expect(bookLog.listForLearner).toHaveBeenCalledTimes(1);
    expect(bookLog.listForLearner).toHaveBeenCalledWith('learner4');
    expect(digest.learners[0].readingActivity).toEqual({
      status: 'ok', studyDay: '2026-08-24', hasActivity: true,
      progressCount: 1, finishedCount: 1, bookCount: 1, minutes: 0,
    });
  });

  it('marks activity unavailable and logs the actual shelf read failure', async () => {
    const failure = new Error('damaged shelf');
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const digest = await useCase({
      bookLog: { listForLearner: vi.fn(async () => { throw failure; }) }, logger,
    }).execute({ studyDay: '2026-08-24', version: 'v2' });

    expect(digest.learners[0].readingActivity).toEqual({
      status: 'unavailable', studyDay: '2026-08-24', hasActivity: null,
    });
    expect(logger.warn).toHaveBeenCalledWith('school.teacher-day.reading-activity-failed', {
      learnerId: 'learner4', error: 'damaged shelf',
    });
  });

  it('leaves the v1 learner-row contract unchanged and does not read the shelf', async () => {
    const bookLog = { listForLearner: vi.fn(async () => []) };
    const rows = await useCase({ bookLog }).execute();

    expect(bookLog.listForLearner).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('readingActivity');
  });
});

// Physical education: the learner is enrolled in nothing, so the only evidence
// is the fitness session log. Sessions are stored by DATE rather than by
// learner, so the digest reads the roster's day ONCE and projects per child.
describe('GetTeacherToday physical-education evidence', () => {
  const workout = (startedAt, participants) => ({ startTime: Date.parse(startedAt), participants });
  const fitnessSessions = (sessions) => ({ listSessionsInRange: vi.fn(async () => sessions) });

  it('credits rings earned on the requested study day with one roster-wide read', async () => {
    const port = fitnessSessions([workout('2026-08-24T15:00:00.000Z', { learner4: { rings: 4 } })]);
    const digest = await useCase({ fitnessSessions: port }).execute({ studyDay: '2026-08-24', version: 'v2' });

    expect(port.listSessionsInRange).toHaveBeenCalledTimes(1);
    expect(port.listSessionsInRange).toHaveBeenCalledWith('2026-08-24', '2026-08-25');
    expect(digest.learners[0].fitnessActivity).toEqual({
      status: 'ok', studyDay: '2026-08-24', hasActivity: true, rings: 4, sessionCount: 1,
    });
  });

  it('reports a quiet day rather than unavailable when the log simply holds no workout', async () => {
    const digest = await useCase({ fitnessSessions: fitnessSessions([]) })
      .execute({ studyDay: '2026-08-24', version: 'v2' });

    expect(digest.learners[0].fitnessActivity).toEqual({
      status: 'ok', studyDay: '2026-08-24', hasActivity: false, rings: 0, sessionCount: 0,
    });
  });

  it('marks activity unavailable and logs the actual session-log failure', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const digest = await useCase({
      fitnessSessions: { listSessionsInRange: async () => { throw new Error('log offline'); } }, logger,
    }).execute({ studyDay: '2026-08-24', version: 'v2' });

    expect(digest.learners[0].fitnessActivity).toEqual({
      status: 'unavailable', studyDay: '2026-08-24', hasActivity: null,
    });
    expect(logger.warn).toHaveBeenCalledWith('school.teacher-day.fitness-activity-failed', {
      error: 'log offline',
    });
  });

  it('reports unavailable rather than a quiet day when no session log is wired at all', async () => {
    const digest = await useCase().execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(digest.learners[0].fitnessActivity).toEqual({
      status: 'unavailable', studyDay: '2026-08-24', hasActivity: null,
    });
  });

  it('leaves the v1 learner-row contract unchanged and does not read the session log', async () => {
    const port = fitnessSessions([]);
    const rows = await useCase({ fitnessSessions: port }).execute();

    expect(port.listSessionsInRange).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('fitnessActivity');
  });
});

// ---------------------------------------------------------------------------
// `reviewStatus` is a REVIEW verdict, and a session that was never worked has
// nothing to render one about. The two-way form answered 'complete' for a
// session minted at agenda-build time — a clean bill of health on work nobody
// had touched — which is what let a dashboard card ask for a grade on an
// untouched lesson.
// ---------------------------------------------------------------------------
function useCaseFor(sessionEvents) {
  return new GetTeacherToday({
    learnerDirectory: { listLearners: async () => [{ id: 'test-learner', name: 'Test Learner' }] },
    datastore: { readAttemptDay: () => [] },
    sessions: {
      listForLearner: async () => [{ sessionId: 'ses_t', updatedAt: sessionEvents.at(-1).at }],
      readEvents: async () => sessionEvents,
    },
    curriculum: {
      listUnits: async () => [{ unitId: 'lesson-1', title: 'Lesson One', subject: 'math', courseId: 'course-1', module: 'unit-a' }],
      listWorks: async () => [{ work: 'course-1', title: 'Course One', subject: 'math', modules: [{ module: 'unit-a', title: 'Unit A' }] }],
    },
    timezone: 'UTC', boundaryHour: 4,
    clock: () => new Date('2026-08-24T18:00:00.000Z'), logger: { debug() {} },
  });
}

const created = { type: 'created', at: '2026-08-24T15:00:00.000Z', sessionId: 'ses_t', seq: 1,
  learnerId: 'test-learner', unitId: 'lesson-1', studyDay: '2026-08-24' };

describe('GetTeacherToday reviewStatus', () => {
  it('reports no review verdict for a session that was only minted', async () => {
    const result = await useCaseFor([created]).execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(result.learners[0].sessions[0]).toMatchObject({ state: 'created', reviewStatus: null });
  });

  it('reports no review verdict while the worksheet is merely out', async () => {
    const result = await useCaseFor([
      created,
      { type: 'issued', at: '2026-08-24T15:01:00.000Z', sessionId: 'ses_t', seq: 2, artifactId: 'art_1' },
    ]).execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(result.learners[0].sessions[0]).toMatchObject({ state: 'issued', reviewStatus: null });
  });

  it('reports complete once the work has been submitted and nothing is queued', async () => {
    const result = await useCaseFor([
      created,
      { type: 'issued', at: '2026-08-24T15:01:00.000Z', sessionId: 'ses_t', seq: 2, artifactId: 'art_1' },
      { type: 'submitted', at: '2026-08-24T16:00:00.000Z', sessionId: 'ses_t', seq: 3, transport: 'paper' },
    ]).execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(result.learners[0].sessions[0].reviewStatus).toBe('complete');
  });
});

describe('GetTeacherToday — remediation holds', () => {
  // A REAL PlanProjection over the shared session fake: the attention list is
  // read off the plan, so the planner's own rules (newest open session per
  // unit, nothing held once passed, school-day idle count) are what is tested.
  const UNIT = { unitId: 'lesson-1', title: 'Lesson One', subject: 'math', courseId: 'course-1', sequence: 1, module: 'unit-a' };

  async function round(sessions, sessionId, { remediationOf = null, next = null, day, percent = 16.67 }) {
    await sessions.appendEvent(sessionId, { type: 'created', at: `${day}T15:00:00.000Z`, learnerId: 'learner4', unitId: 'lesson-1',
      ...(remediationOf ? { remediationOf } : {}) });
    await sessions.appendEvent(sessionId, { type: 'issued', at: `${day}T15:01:00.000Z`, artifactId: `art_${sessionId}` });
    await sessions.appendEvent(sessionId, { type: 'submitted', at: `${day}T16:00:00.000Z`, transport: 'paper' });
    await sessions.appendEvent(sessionId, { type: 'graded', at: `${day}T16:01:00.000Z`,
      attemptIds: [`att_${sessionId}`], percent, passingPercent: 80, correctCount: percent >= 80 ? 6 : 1, totalCount: 6 });
    await sessions.appendEvent(sessionId, { type: 'outcome_recorded', at: `${day}T16:02:00.000Z`, outcomeId: `out_${sessionId}`,
      result: percent >= 80 ? 'passed' : 'needs_remediation' });
    if (next) await sessions.appendEvent(sessionId, { type: 'remediation_opened', at: `${day}T16:03:00.000Z`, newSessionId: next, variant: 1 });
  }

  function harness({ now = '2026-10-02T18:00:00.000Z', remediationMaxRounds = null } = {}) {
    const sessions = new FakeSessionRepository();
    const clock = () => new Date(now);
    const curriculum = { listUnits: async () => [UNIT], listWorks: async () => [] };
    const planProjection = new PlanProjection({
      curriculum, sessions, clock, timezone: 'UTC', remediationMaxRounds, logger: { info() {}, warn() {}, debug() {} },
      assignments: { get: async () => ({ courses: [{ courseId: 'course-1', enrollment: { schedule: { daysOfWeek: [1, 2, 3, 4, 5] } } }] }) },
    });
    return {
      sessions,
      useCase: useCase({ sessions, curriculum, clock, planProjection }),
    };
  }

  it('lists a unit two retries deep as remediation-cap', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-10-01', next: 'ses_1' });
    await round(sessions, 'ses_1', { day: '2026-10-01', remediationOf: 'ses_0', next: 'ses_2' });
    await round(sessions, 'ses_2', { day: '2026-10-01', remediationOf: 'ses_1' });
    const digest = await teacherDay.execute({ version: 'v2' });
    expect(digest.learners[0].attention).toEqual([{
      kind: 'remediation-cap', learnerId: 'learner4', sessionId: 'ses_2',
      unitId: 'lesson-1', unitTitle: 'Lesson One', depth: 2, maxRounds: 2, idleStudyDays: 0,
      lastScore: { percent: 16.67, correctCount: 1, totalCount: 6 },
      since: '2026-10-01T16:02:00.000Z',
    }]);
  });

  it('lists the 9/26 shape — a depth-0 failure never retried — as remediation-stale', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-09-26' }); // a Saturday in UTC; Mon–Thu pass after it
    const [item] = (await teacherDay.execute({ version: 'v2' })).learners[0].attention;
    expect(item).toMatchObject({ kind: 'remediation-stale', sessionId: 'ses_0', depth: 0, idleStudyDays: 4 });
  });

  it('says nothing while the child still has a retry coming', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-10-01', next: 'ses_1' });
    await round(sessions, 'ses_1', { day: '2026-10-01', remediationOf: 'ses_0' });
    expect((await teacherDay.execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('skips a unit that has since been passed', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-09-22' }); // stale, still open
    await round(sessions, 'ses_pass', { day: '2026-10-01', percent: 100 });
    expect((await teacherDay.execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('judges only the newest open session on a unit', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_old', { day: '2026-09-22' }); // stale on its own
    await round(sessions, 'ses_new', { day: '2026-10-01' }); // fresh
    expect((await teacherDay.execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('honours a configured cap', async () => {
    const { sessions, useCase: teacherDay } = harness({ remediationMaxRounds: 3 });
    await round(sessions, 'ses_0', { day: '2026-10-01', next: 'ses_1' });
    await round(sessions, 'ses_1', { day: '2026-10-01', remediationOf: 'ses_0', next: 'ses_2' });
    await round(sessions, 'ses_2', { day: '2026-10-01', remediationOf: 'ses_1' });
    expect((await teacherDay.execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('a past study day reads holds as of that day, not as of now', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-09-22' }); // stale by 10/02
    expect((await teacherDay.execute({ studyDay: '2026-09-23' })).learners[0].attention).toEqual([]);
    expect((await teacherDay.execute({ studyDay: '2026-09-28' })).learners[0].attention)
      .toEqual([expect.objectContaining({ kind: 'remediation-stale', idleStudyDays: 3 })]);
  });

  it('rides on the v1 rows too, and is empty without a projection', async () => {
    const { sessions, useCase: teacherDay } = harness();
    await round(sessions, 'ses_0', { day: '2026-09-22' });
    expect((await teacherDay.execute())[0].attention).toHaveLength(1);
    expect((await useCase().execute())[0].attention).toEqual([]);
  });
});

describe('GetTeacherToday piano evidence', () => {
  it('reads one learner\'s piano study day through the port, inside the study window', async () => {
    const port = { forLearnerDay: vi.fn(async () => ({ exercises: 4, passed: 3, gameSeconds: 1200 })) };
    const digest = await useCase({ pianoDayActivity: port }).execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(port.forLearnerDay).toHaveBeenCalledWith(expect.objectContaining({ studyDay: '2026-08-24', fromMs: expect.any(Number), toMs: expect.any(Number) }));
    const [call] = port.forLearnerDay.mock.calls[0];
    expect(call.toMs - call.fromMs).toBe(24 * 60 * 60 * 1000);
    expect(digest.learners[0].pianoActivity).toEqual({ status: 'ok', studyDay: '2026-08-24', exercises: 4, passed: 3, gameSeconds: 1200 });
  });

  it('is unavailable, never a zero, when the port is missing or throws', async () => {
    const none = await useCase().execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(none.learners[0].pianoActivity).toEqual({ status: 'unavailable', studyDay: '2026-08-24' });
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const failing = await useCase({ logger, pianoDayActivity: { forLearnerDay: () => { throw new Error('disk'); } } })
      .execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(failing.learners[0].pianoActivity.status).toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith('school.teacher-day.piano-activity-failed', expect.objectContaining({ error: 'disk' }));
  });
});

