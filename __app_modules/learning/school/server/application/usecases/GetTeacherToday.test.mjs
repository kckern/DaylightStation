import { describe, it, expect, vi } from 'vitest';
import { GetTeacherToday } from "./GetTeacherToday.mjs";
import { schoolArtifactRef } from '#apps/common/resources/publicResourceRefs.mjs';

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
      progressCount: 1, finishedCount: 1, bookCount: 1,
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

describe('GetTeacherToday — remediation cap', () => {
  /** One failed round on `math.01`: issued, graded at `percent`, settled needs_remediation. */
  const round = (sessionId, { remediationOf = null, percent, next = null, day }) => [
    { type: 'created', at: `${day}T15:00:00.000Z`, sessionId, seq: 1, learnerId: 'learner4', unitId: 'lesson-1',
      ...(remediationOf ? { remediationOf } : {}) },
    { type: 'issued', at: `${day}T15:01:00.000Z`, sessionId, seq: 2, artifactId: `art_${sessionId}` },
    { type: 'submitted', at: `${day}T16:00:00.000Z`, sessionId, seq: 3, transport: 'paper' },
    { type: 'graded', at: `${day}T16:01:00.000Z`, sessionId, seq: 4,
      attemptIds: [`att_${sessionId}`], percent, passingPercent: 80, correctCount: 1, totalCount: 6 },
    { type: 'outcome_recorded', at: `${day}T16:02:00.000Z`, sessionId, seq: 5, outcomeId: `out_${sessionId}`, result: 'needs_remediation' },
    ...(next ? [{ type: 'remediation_opened', at: `${day}T16:03:00.000Z`, sessionId, seq: 6, newSessionId: next, variant: 1 }] : []),
  ];
  const logs = (rounds) => ({
    ses_0: round('ses_0', { percent: 16.67, next: rounds >= 1 ? 'ses_1' : null, day: '2026-09-26' }),
    ...(rounds >= 1 ? { ses_1: round('ses_1', { remediationOf: 'ses_0', percent: 16.67, next: rounds >= 2 ? 'ses_2' : null, day: '2026-09-29' }) } : {}),
    ...(rounds >= 2 ? { ses_2: round('ses_2', { remediationOf: 'ses_1', percent: 16.67, day: '2026-09-30' }) } : {}),
  });
  const withRounds = (rounds, extra = {}) => {
    const byId = logs(rounds);
    return useCase({
      sessions: {
        listForLearner: async () => Object.keys(byId).map((sessionId) => ({ sessionId, updatedAt: byId[sessionId].at(-1).at })),
        readEvents: async (sessionId) => byId[sessionId] ?? [],
      },
      clock: () => new Date('2026-10-02T18:00:00.000Z'),
      ...extra,
    });
  };

  it('surfaces a unit two rounds deep as a remediation-cap item for the grown-up', async () => {
    const digest = await withRounds(2).execute({ version: 'v2' });
    expect(digest.learners[0].attention).toEqual([{
      kind: 'remediation-cap', learnerId: 'learner4', sessionId: 'ses_2',
      unitId: 'lesson-1', unitTitle: 'Lesson One', depth: 2, maxRounds: 2,
      lastScore: { percent: 16.67, correctCount: 1, totalCount: 6 },
      since: '2026-09-30T16:02:00.000Z',
    }]);
  });

  it('says nothing while the child still has a retry coming', async () => {
    expect((await withRounds(1).execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('honours a configured cap', async () => {
    expect((await withRounds(2, { remediationMaxRounds: 3 }).execute({ version: 'v2' })).learners[0].attention).toEqual([]);
  });

  it('rides on the v1 rows too', async () => {
    expect((await withRounds(2).execute())[0].attention).toHaveLength(1);
  });
});
