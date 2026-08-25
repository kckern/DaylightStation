/**
 * Report cards, period close, and the teacher-today digest (Task 6, spec
 * R5b). Everything below calls the use cases directly against in-memory
 * fakes, same idiom as `RecordCardScanOutcome.test.mjs`: fakes record what
 * they were told and answer real queries, so a test asserts on EFFECTS
 * rather than on internal calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { GetReportCard } from '#apps/school/usecases/GetReportCard.mjs';
import { CloseAcademicPeriod } from '#apps/school/usecases/CloseAcademicPeriod.mjs';
import { GetTeacherToday } from '#apps/school/usecases/GetTeacherToday.mjs';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { COURSE_GRADE_POLICY } from '#domains/school/progress/courseGrade.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const PERIOD = {
  schema: 'school.academic-period/v1',
  periodId: 'fall-2026',
  kind: 'term',
  label: 'Fall 2026',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
};

function fakeAcademicPeriods(period = PERIOD) {
  return {
    getPeriod: (id) => (id === period.periodId ? period : null),
    listPeriods: () => [period],
  };
}

function fakeCurriculum(units) {
  return { listUnits: async () => units };
}

function fakeAssignments(historyByLearner = {}, currentByLearner = {}) {
  return {
    history: async (learnerId) => historyByLearner[learnerId] ?? [],
    get: async (learnerId) => currentByLearner[learnerId] ?? null,
  };
}

function fakeSessions(rows = [], eventsBySession = {}) {
  return {
    async listForLearner(learnerId) {
      return rows.filter((r) => r.learnerId === learnerId).map((r) => ({ ...r }));
    },
    async readEvents(sessionId) {
      return (eventsBySession[sessionId] ?? []).map((e) => ({ ...e }));
    },
  };
}

function fakeSchoolDatastore({ attempts = {} } = {}) {
  const reportCards = new Map(); // learnerId -> Map(periodId -> record)
  const archiveVersions = new Map(); // learnerId -> Map(periodId -> n)
  return {
    // A `vi.fn` wrapper (not a plain method) so call-count assertions can
    // pin the "one shared read" contract `#periodAttempts` exists to
    // guarantee — `#activeDaysSection` and `#conceptsSection` must consume
    // the SAME read, never each trigger their own.
    readAttemptsInRange: vi.fn((learnerId, fromDay, toDay) => (attempts[learnerId] ?? []).filter((a) => {
      const day = String(a.at).slice(0, 10);
      return day >= fromDay && day <= toDay;
    })),
    readAttemptDay(learnerId, day) {
      return (attempts[learnerId] ?? []).filter((a) => String(a.at).slice(0, 10) === day);
    },
    readReportCard(learnerId, periodId) {
      return reportCards.get(learnerId)?.get(periodId) ?? null;
    },
    async writeReportCard(learnerId, periodId, payload) {
      if (!reportCards.has(learnerId)) reportCards.set(learnerId, new Map());
      const forLearner = reportCards.get(learnerId);
      if (forLearner.has(periodId)) {
        throw new DomainInvariantError(`Report card for period '${periodId}' is already closed`, {
          code: 'REPORT_CARD_ALREADY_CLOSED',
        });
      }
      forLearner.set(periodId, structuredClone(payload));
      return payload;
    },
    async archiveReportCard(learnerId, periodId) {
      const forLearner = reportCards.get(learnerId);
      const existing = forLearner?.get(periodId);
      if (!existing) return 0;
      if (!archiveVersions.has(learnerId)) archiveVersions.set(learnerId, new Map());
      const versions = archiveVersions.get(learnerId);
      const n = (versions.get(periodId) ?? 0) + 1;
      versions.set(periodId, n);
      forLearner.delete(periodId);
      return n;
    },
    listReportCards(learnerId) {
      return [...(reportCards.get(learnerId)?.values() ?? [])];
    },
  };
}

const ROSTER = [
  { id: 'dad', name: 'Papa', birthyear: 1984 },
  { id: 'kid1', name: 'Kid One', birthyear: 2016 },
];

function fakeGrownUps(clock = () => new Date('2026-12-05T09:00:00.000Z')) {
  return new GrownUpGate({ roster: () => ROSTER, clock, logger: silent });
}

function unit({
  unitId, courseId, sequence = 1, subject = 'math',
} = {}) {
  return {
    unitId, courseId, sequence, subject, title: unitId, objectives: [], grades: [],
  };
}

function sessionRow({
  sessionId, learnerId = 'kid1', unitId, state = 'outcome_recorded', terminal = true,
  result = null, gradedPercent = null, day, updatedAt,
} = {}) {
  return {
    sessionId,
    learnerId,
    unitId,
    state,
    terminal,
    outcome: result ? { result } : null,
    gradedPercent,
    // The real datastore derives `day` from the session's CREATED-event date,
    // not from `updatedAt` — but for a single-timestamp fixture, deriving it
    // the same way (rather than letting a caller hand-set a `day` that could
    // silently diverge from `updatedAt`) is what keeps a test honest about
    // which field the use case under test actually reads.
    day: day ?? (typeof updatedAt === 'string' ? updatedAt.slice(0, 10) : null),
    updatedAt,
  };
}

/** A raw School attempt row, as `readAttemptsInRange` returns it — enough
 * shape for `learningEvidenceFromAttempt` to turn into graded evidence. */
function attempt({
  id, learnerId = 'kid1', bankId = 'math/work/check', itemId = 'q1', mode = 'quiz',
  correct = true, at, conceptIds = ['fractions-add'], transport = 'screen',
} = {}) {
  return {
    id,
    attributedTo: learnerId,
    at,
    sessionId: `${id}-session`,
    bankId,
    itemId,
    mode,
    correct,
    transport,
    learning: { conceptIds },
  };
}

describe('GetReportCard', () => {
  it('period-scoped course selection: a course assigned during the period but since unassigned STILL appears', async () => {
    const history = [
      // In effect BEFORE the period started: math-fractions only.
      {
        learnerId: 'kid1', courses: ['math-fractions'], units: [], assignedBy: 'dad', recordedAt: '2026-07-01T00:00:00.000Z',
      },
      // Mid-period: history is ADDED.
      {
        learnerId: 'kid1', courses: ['math-fractions', 'history-capitals'], units: [], assignedBy: 'dad', recordedAt: '2026-09-01T00:00:00.000Z',
      },
      // Later in the SAME period: history is dropped again.
      {
        learnerId: 'kid1', courses: ['math-fractions'], units: [], assignedBy: 'dad', recordedAt: '2026-10-01T00:00:00.000Z',
      },
    ];
    const units = [
      unit({ unitId: 'frac.01', courseId: 'math-fractions', sequence: 1 }),
      unit({ unitId: 'caps.01', courseId: 'history-capitals', sequence: 1, subject: 'history' }),
    ];
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum(units),
      assignments: fakeAssignments({ kid1: history }),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });

    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.courses.map((c) => c.courseId).sort()).toEqual(['history-capitals', 'math-fractions']);
  });

  it('falls back to the CURRENT assignment when history is EMPTY (legacy learner predates Task 3)', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum(units),
      // No history at all for kid1 — only a plain `assignments.get` record.
      assignments: fakeAssignments({}, {
        kid1: {
          learnerId: 'kid1', courses: ['math-fractions'], units: [], assignedBy: 'dad', updatedAt: '2026-07-01T00:00:00.000Z',
        },
      }),
      sessions: fakeSessions([]), // no graded sessions either — (b) contributes nothing
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });

    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.courses.map((c) => c.courseId)).toEqual(['math-fractions']);
  });

  it('a graded session whose unitId no longer resolves is SURFACED flagged, never silently dropped (admin advocacy A2)', async () => {
    // The catalog only knows frac.01; ghost.99 was graded in September and
    // then re-cut out of the catalog.
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const warns = [];
    const history = [{
      learnerId: 'kid1', courses: ['math-fractions'], units: [], assignedBy: 'dad', recordedAt: '2026-07-01T00:00:00.000Z',
    }];
    const rows = [
      sessionRow({ sessionId: 'ses_ok', unitId: 'frac.01', updatedAt: '2026-09-01T00:00:00.000Z', gradedPercent: 90, result: 'passed' }),
      sessionRow({ sessionId: 'ses_ghost', unitId: 'ghost.99', updatedAt: '2026-09-02T00:00:00.000Z', gradedPercent: 85, result: 'passed' }),
      sessionRow({ sessionId: 'ses_ghost2', unitId: 'ghost.99', updatedAt: '2026-09-03T00:00:00.000Z', gradedPercent: 70, result: 'passed' }),
    ];
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum(units),
      assignments: fakeAssignments({ kid1: history }),
      sessions: fakeSessions(rows),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: { warn: (...a) => warns.push(a), debug() {}, error() {}, info() {} },
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.unresolvedUnits).toEqual([{ unitId: 'ghost.99', sessions: 2, bestPercent: 85 }]);
    expect(warns.some(([evt, data]) => evt === 'school.report-card.unit-unresolved'
      && data.unitIds.includes('ghost.99'))).toBe(true);
    // The resolvable course is untouched.
    expect(card.courses.find((c) => c.courseId === 'math-fractions')).toBeTruthy();
  });

  it('an empty history AND no current assignment reports zero courses, never a crash', async () => {
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}, {}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.courses).toEqual([]);
  });

  it('composes course grades from session rows using Task 5\'s projection, flattening outcome.result', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const rows = [
      sessionRow({
        sessionId: 'ses_1', unitId: 'frac.01', result: 'passed', gradedPercent: 90, updatedAt: '2026-09-10T10:00:00.000Z',
      }),
    ];
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum(units),
      assignments: fakeAssignments({
        kid1: [{
          learnerId: 'kid1', courses: ['math-fractions'], units: [], assignedBy: 'dad', recordedAt: '2026-07-01T00:00:00.000Z',
        }],
      }),
      sessions: fakeSessions(rows),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });

    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    const course = card.courses.find((c) => c.courseId === 'math-fractions');
    expect(course.policy).toBe(COURSE_GRADE_POLICY);
    expect(course.coursePercent).toBe(90);
    expect(course.unitGrades).toEqual([{
      unitId: 'frac.01', bestPercent: 90, passed: true, attempts: 1,
    }]);
    // A real outcome.result: 'passed' row must flatten and produce passed: true
    // (the ruling this pins) — surfaced again on unitOutcomes.
    expect(course.unitOutcomes).toEqual([{
      unitId: 'frac.01', result: 'passed', gradedPercent: 90, sessionId: 'ses_1',
    }]);
  });

  it('materials section is present from GetMaterialProgressSummary', async () => {
    const getMaterialProgressSummary = {
      execute: vi.fn(async () => [
        {
          materialId: 'plex:v1', unitsDone: 2, unitTotal: 5, nextUnitId: null, nextUnitTitle: null, percent: 40, lastActivity: null,
        },
      ]),
    };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      getMaterialProgressSummary,
      logger: silent,
    });

    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(getMaterialProgressSummary.execute).toHaveBeenCalledWith({ userId: 'kid1' });
    expect(card.materials).toEqual([{
      materialId: 'plex:v1', label: 'plex:v1', unitsDone: 2, unitTotal: 5,
    }]);
  });

  it('materials degrades to [] when the use case is not wired, never a crash', async () => {
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.materials).toEqual([]);
  });

  it('evidence degrades to null when GetLearningProgress is not wired', async () => {
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.evidence).toBe(null);
  });

  it('evidence invokes GetLearningProgress scoped to the learner with the period\'s from/to', async () => {
    const getLearningProgress = { execute: vi.fn(async () => ({ ok: true })) };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      getLearningProgress,
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(getLearningProgress.execute).toHaveBeenCalledWith({
      scopeType: 'learner', scopeId: 'kid1', from: PERIOD.startsAt, to: PERIOD.endsAt,
    });
    expect(card.evidence).toEqual({ ok: true });
  });

  it('activeDays counts distinct attempt-day FILES per subject and overall — never "attendance"', async () => {
    const attempts = {
      kid1: [
        {
          at: '2026-09-01T09:00:00.000Z', correct: true, learning: { subjectId: 'math' },
        },
        {
          at: '2026-09-01T15:00:00.000Z', correct: false, learning: { subjectId: 'math' },
        }, // same day, math — must not double count the day
        {
          at: '2026-09-02T09:00:00.000Z', correct: true, learning: { subjectId: 'history' },
        },
        {
          at: '2026-09-03T09:00:00.000Z', correct: true, learning: null,
        }, // no subject — counts toward total, not toward any subject
      ],
    };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore({ attempts }),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.activeDays).toEqual({
      bySubject: [{ subjectId: 'history', days: 1 }, { subjectId: 'math', days: 1 }],
      total: 3,
    });
  });

  it('concepts aggregates graded attempts into mastered/developing, honoring the domain thresholds and labeling from the registry', async () => {
    const strongAttempts = Array.from({ length: 5 }, (_, i) => attempt({
      id: `strong-${i}`, correct: true, at: `2026-09-0${i + 1}T09:00:00.000Z`, conceptIds: ['strong-concept'],
    }));
    const weakAttempts = Array.from({ length: 5 }, (_, i) => attempt({
      id: `weak-${i}`, correct: i < 1, at: `2026-09-1${i}T09:00:00.000Z`, conceptIds: ['weak-concept'],
    }));
    const conceptRegistry = { get: (id) => (id === 'strong-concept' ? { id, label: 'Strong Concept' } : null) };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore({ attempts: { kid1: [...strongAttempts, ...weakAttempts] } }),
      academicPeriods: fakeAcademicPeriods(),
      conceptRegistry,
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.concepts.mastered).toEqual([
      {
        conceptId: 'strong-concept', label: 'Strong Concept', ratio: 1, responses: 5,
      },
    ]);
    // Registry has no entry for 'weak-concept' — the raw id is the honest fallback label.
    expect(card.concepts.developing).toEqual([
      {
        conceptId: 'weak-concept', label: 'weak-concept', ratio: 0.2, responses: 5,
      },
    ]);
  });

  it('concepts degrades to empty mastered/developing arrays when no conceptRegistry is wired, never a crash', async () => {
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.concepts).toEqual({ mastered: [], developing: [] });
  });

  it('concepts falls back to the raw conceptId as label when the registry has no entry for it at all', async () => {
    const attempts = Array.from({ length: 5 }, (_, i) => attempt({
      id: `a-${i}`, correct: true, at: `2026-09-0${i + 1}T09:00:00.000Z`, conceptIds: ['unregistered-id'],
    }));
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore({ attempts: { kid1: attempts } }),
      academicPeriods: fakeAcademicPeriods(),
      // No conceptRegistry wired at all — labeling must still degrade gracefully.
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.concepts.mastered).toEqual([
      {
        conceptId: 'unregistered-id', label: 'unregistered-id', ratio: 1, responses: 5,
      },
    ]);
  });

  it('reads attempts for the period exactly ONCE — activeDays and concepts share the same read, never two independent reads', async () => {
    const attempts = { kid1: [{ at: '2026-09-01T09:00:00.000Z', correct: true, learning: { subjectId: 'math' } }] };
    const datastore = fakeSchoolDatastore({ attempts });
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore,
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(datastore.readAttemptsInRange).toHaveBeenCalledTimes(1);
    expect(datastore.readAttemptsInRange).toHaveBeenCalledWith('kid1', '2026-08-01', '2026-12-01');
  });

  it('a boundary-day attempt outside the exact period instant window is excluded from BOTH activeDays and concepts, even though the day-file read includes it', async () => {
    // Non-midnight bounds so "the start day" and "the instant startsAt" are
    // different moments — the gap the day-granular file read can leak.
    const period = {
      schema: 'school.academic-period/v1',
      periodId: 'narrow',
      kind: 'custom',
      label: 'Narrow',
      startsAt: '2026-09-01T12:00:00.000Z',
      endsAt: '2026-09-03T12:00:00.000Z',
    };
    const attempts = {
      kid1: [
        // Same DAY as startsAt but BEFORE the instant startsAt — the day-file
        // read (bounded 09-01..09-03) would include it; the instant filter
        // must not.
        attempt({ id: 'before-start', at: '2026-09-01T09:00:00.000Z', conceptIds: ['c1'] }),
        // Genuinely inside the window.
        attempt({ id: 'inside', at: '2026-09-02T09:00:00.000Z', conceptIds: ['c1'] }),
        // Exactly AT endsAt — the window is half-open ([startsAt, endsAt)),
        // so this is the next period's first instant, not this one's.
        attempt({ id: 'at-end', at: '2026-09-03T12:00:00.000Z', conceptIds: ['c1'] }),
      ],
    };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore({ attempts }),
      academicPeriods: fakeAcademicPeriods(period),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'narrow' });
    // activeDays: only 09-02 counts — 09-01 (before-start) and 09-03
    // (at-end) must both be excluded.
    expect(card.activeDays.total).toBe(1);
    // concepts: only the ONE inside attempt's response counts toward c1 —
    // 3 would mean the boundary attempts leaked in.
    const c1 = [...card.concepts.mastered, ...card.concepts.developing].find((r) => r.conceptId === 'c1');
    expect(c1.responses).toBe(1);
  });

  it('remediationArcs links a needs_remediation session to its later OpenRemediation session on the same unit', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const rows = [
      sessionRow({
        sessionId: 'ses_orig', unitId: 'frac.01', result: 'needs_remediation', gradedPercent: 50, updatedAt: '2026-09-01T10:00:00.000Z',
      }),
      sessionRow({
        sessionId: 'ses_retry', unitId: 'frac.01', result: 'passed', gradedPercent: 95, updatedAt: '2026-09-05T10:00:00.000Z',
      }),
      // A decoy: same unit, later, but NOT linked via remediationOf.
      sessionRow({
        sessionId: 'ses_unrelated', unitId: 'frac.01', result: 'passed', gradedPercent: 100, updatedAt: '2026-09-06T10:00:00.000Z',
      }),
    ];
    const events = {
      ses_retry: [{ type: 'created', at: '2026-09-05T10:00:00.000Z', remediationOf: 'ses_orig' }],
      ses_unrelated: [{ type: 'created', at: '2026-09-06T10:00:00.000Z' }],
    };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum(units),
      assignments: fakeAssignments({}),
      sessions: fakeSessions(rows, events),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.remediationArcs).toEqual([{
      unitId: 'frac.01', originalSessionId: 'ses_orig', remediationSessionId: 'ses_retry', result: 'passed',
    }]);
  });

  it('pendingReview counts only this learner\'s items on the review queue', async () => {
    const reviewQueue = {
      listPending: async () => [
        { learnerId: 'kid1', itemId: 'q1' },
        { learnerId: 'kid1', itemId: 'q2' },
        { learnerId: 'other-kid', itemId: 'q3' },
      ],
    };
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      reviewQueue,
      logger: silent,
    });
    const card = await useCase.execute({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(card.pendingReview).toBe(2);
  });

  it('an unknown periodId is EntityNotFoundError', async () => {
    const useCase = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: fakeSchoolDatastore(),
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    await expect(useCase.execute({ learnerId: 'kid1', periodId: 'ghost-period' }))
      .rejects.toMatchObject({ name: 'EntityNotFoundError' });
  });
});

describe('CloseAcademicPeriod', () => {
  function makeCase({ clock = () => new Date('2026-12-05T09:00:00.000Z'), datastore } = {}) {
    const store = datastore ?? fakeSchoolDatastore();
    const getReportCard = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: store,
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    const closeAcademicPeriod = new CloseAcademicPeriod({
      getReportCard, datastore: store, grownUps: fakeGrownUps(clock), clock, logger: silent,
    });
    return { closeAcademicPeriod, store };
  }

  it('a grown-up closes a period: the freeze carries closedBy/closedAt and supersededVersions: 0', async () => {
    const { closeAcademicPeriod, store } = makeCase();
    const frozen = await closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' });
    expect(frozen).toMatchObject({
      closedBy: 'dad', closedAt: '2026-12-05T09:00:00.000Z', supersededVersions: 0, learnerId: 'kid1',
    });
    expect(store.readReportCard('kid1', 'fall-2026')).toMatchObject({ closedBy: 'dad' });
  });

  it('a plain re-close REFUSES with REPORT_CARD_ALREADY_CLOSED', async () => {
    const { closeAcademicPeriod } = makeCase();
    await closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' });
    await expect(closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' }))
      .rejects.toMatchObject({ name: 'DomainInvariantError', code: 'REPORT_CARD_ALREADY_CLOSED' });
  });

  it('supersede: true archives the existing freeze to v1 and writes anew — the old record survives', async () => {
    const { closeAcademicPeriod, store } = makeCase();
    await closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' });
    const resuperseded = await closeAcademicPeriod.execute({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true,
    });
    expect(resuperseded.supersededVersions).toBe(1);
    // The CURRENT record is the new freeze, not destroyed by the archive.
    expect(store.readReportCard('kid1', 'fall-2026')).toMatchObject({ supersededVersions: 1 });
    // listReportCards only ever sees the one CURRENT (unversioned) record —
    // the archived v1 copy is a separate file, never surfaced as "current".
    expect(store.listReportCards('kid1')).toHaveLength(1);
  });

  it('a second supersede archives to v2, never overwriting v1', async () => {
    const { closeAcademicPeriod } = makeCase();
    await closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' });
    await closeAcademicPeriod.execute({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true,
    });
    const third = await closeAcademicPeriod.execute({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true,
    });
    expect(third.supersededVersions).toBe(2);
  });

  it('supersede: a report-generation failure leaves the ORIGINAL frozen record intact and readable — never a mid-failure 404', async () => {
    const store = fakeSchoolDatastore();
    let calls = 0;
    // First call (the initial close) succeeds; the second call (the
    // supersede's re-generation) blows up — simulating a report build
    // failure mid-supersede.
    const getReportCard = {
      execute: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            schema: 'school.report-card/v1', learnerId: 'kid1', period: PERIOD, courses: [],
          };
        }
        throw new Error('report build blew up');
      }),
    };
    const closeAcademicPeriod = new CloseAcademicPeriod({
      getReportCard, datastore: store, grownUps: fakeGrownUps(), logger: silent,
    });
    await closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad' });
    const original = store.readReportCard('kid1', 'fall-2026');
    expect(original).toBeTruthy();

    await expect(closeAcademicPeriod.execute({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true,
    })).rejects.toThrow('report build blew up');

    // Generate-before-archive means the failed re-generation never reached
    // `archiveReportCard` — the original freeze is still the CURRENT record,
    // never unlinked, never a readReportCard 404 window.
    expect(store.readReportCard('kid1', 'fall-2026')).toEqual(original);
  });

  it('a non-grown-up closedBy REFUSES, and nothing is written', async () => {
    const { closeAcademicPeriod, store } = makeCase();
    await expect(closeAcademicPeriod.execute({ learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'kid1' }))
      .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(store.readReportCard('kid1', 'fall-2026')).toBe(null);
  });

  it('cannot be built without a grown-up gate', () => {
    const store = fakeSchoolDatastore();
    const getReportCard = new GetReportCard({
      curriculum: fakeCurriculum([]),
      assignments: fakeAssignments({}),
      sessions: fakeSessions([]),
      datastore: store,
      academicPeriods: fakeAcademicPeriods(),
      logger: silent,
    });
    expect(() => new CloseAcademicPeriod({ getReportCard, datastore: store })).toThrow(/grownUps/);
  });
});

describe('GetTeacherToday', () => {
  it('counts only TODAY\'s (study-day, 4am boundary) attempts and sessions per roster learner', async () => {
    const clock = () => new Date('2026-09-10T10:00:00.000Z'); // well after the 4am boundary
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    // Distinct `itemId`s, deliberately: `uniqueAttempts` collapses rows sharing
    // a session+item+scan identity (the same question re-read off one rescanned
    // sheet is ONE attempt). Two identity-less rows would dedupe to one and the
    // count below would silently measure the dedup rather than the window.
    const attempts = {
      kid1: [
        { at: '2026-09-10T09:00:00.000Z', correct: true, sessionId: 'ses_today', itemId: 'q1' },
        { at: '2026-09-10T09:05:00.000Z', correct: false, sessionId: 'ses_today', itemId: 'q2' },
        // Before today's 4am boundary — must NOT count.
        { at: '2026-09-09T23:00:00.000Z', correct: true, sessionId: 'ses_yesterday', itemId: 'q3' },
      ],
    };
    const rows = [
      sessionRow({
        sessionId: 'ses_today', unitId: 'frac.01', state: 'in_progress', terminal: false, updatedAt: '2026-09-10T09:00:00.000Z',
      }),
      sessionRow({
        sessionId: 'ses_yesterday', unitId: 'frac.02', state: 'outcome_recorded', updatedAt: '2026-09-09T09:00:00.000Z',
      }),
    ];
    // The use case reduces the EVENT STREAM (an index row alone is skipped —
    // `if (!events.length) continue`), and derives a session's study day from
    // its `created` event rather than from `updatedAt`. Supplying the stream is
    // what makes "which day does this session belong to" a real assertion.
    const events = {
      ses_today: [
        { seq: 1, type: 'created', at: '2026-09-10T09:00:00.000Z', sessionId: 'ses_today', learnerId: 'kid1', unitId: 'frac.01' },
      ],
      ses_yesterday: [
        { seq: 1, type: 'created', at: '2026-09-09T09:00:00.000Z', sessionId: 'ses_yesterday', learnerId: 'kid1', unitId: 'frac.02' },
      ],
    };
    const reviewQueue = { listPending: async () => [{ learnerId: 'kid1', itemId: 'q1' }] };
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts }),
      sessions: fakeSessions(rows, events),
      reviewQueue,
      clock,
      logger: silent,
    });

    const digest = await useCase.execute();
    expect(digest).toHaveLength(1);
    const [row] = digest;
    expect(row).toMatchObject({
      learnerId: 'kid1',
      attemptsToday: 2,
      correctToday: 1,
      pendingReview: 1,
      reflectionsToday: [],
    });
    // Only today's session is listed; yesterday's is filed by ITS created-day
    // and must not leak into today's digest.
    expect(row.sessionsToday).toEqual([
      expect.objectContaining({ unitId: 'frac.01', state: 'created', studyDay: '2026-09-10' }),
    ]);
  });

  it('surfaces today\'s reflections (kid\'s own words) when an evidence repo is wired; failures degrade to []', async () => {
    const clock = () => new Date('2026-09-10T10:00:00.000Z');
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    const evidenceRepository = {
      listEvidence: async () => [
        { kind: 'reflection', occurredAt: '2026-09-10T09:30:00.000Z', selfRegulation: { selfAssessment: 'uncertain', confidence: 2, note: 'fractions felt hard' } },
        { kind: 'reflection', occurredAt: '2026-09-09T01:00:00.000Z', selfRegulation: { selfAssessment: 'ready' } }, // yesterday — excluded
        { kind: 'assessment', occurredAt: '2026-09-10T09:00:00.000Z' }, // not a reflection
      ],
    };
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts: {} }),
      sessions: fakeSessions([]),
      evidenceRepository,
      clock,
      logger: silent,
    });
    const digest = await useCase.execute();
    expect(digest[0].reflectionsToday).toEqual([{
      selfAssessment: 'uncertain', confidence: 2, note: 'fractions felt hard', at: '2026-09-10T09:30:00.000Z',
    }]);

    const broken = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts: {} }),
      sessions: fakeSessions([]),
      evidenceRepository: { listEvidence: async () => { throw new Error('ledger offline'); } },
      clock,
      logger: silent,
    });
    expect((await broken.execute())[0].reflectionsToday).toEqual([]);
  });

  // The two boundary reproductions from code review: raw day-FILE date
  // (`at.slice(0,10)`) and the study-day WINDOW disagree around 4am, in both
  // directions. A single boundary-shifted date string cannot answer either
  // case correctly — the fix reads every day file the window can touch and
  // filters by each attempt's own timestamp.
  it('a 03:15Z attempt IS visible when queried at 03:30Z — same not-yet-rolled study day, even though it is filed under TOMORROW\'s raw date', async () => {
    // The study day live at 03:30Z on the 10th started 04:00Z on the 9th and
    // runs to 04:00Z on the 10th. A naive single-date lookup would compute
    // "2026-09-09" (03:30 shifted back 4h) and never see this attempt, which
    // the datastore actually filed under "2026-09-10" (its own raw date).
    const clock = () => new Date('2026-09-10T03:30:00.000Z');
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    const attempts = { kid1: [{ at: '2026-09-10T03:15:00.000Z', correct: true }] };
    const rows = [sessionRow({ sessionId: 'ses_edge', unitId: 'frac.01', updatedAt: '2026-09-10T03:15:00.000Z' })];
    // The reduced state comes from the event chain, not the index row: the
    // shortest legal path to `outcome_recorded` is created -> dispatched ->
    // recorded (see TRANSITIONS in sessionEvents.mjs).
    const events = {
      ses_edge: [
        { seq: 1, type: 'created', at: '2026-09-10T03:15:00.000Z', sessionId: 'ses_edge', learnerId: 'kid1', unitId: 'frac.01' },
        { seq: 2, type: 'program_dispatched', at: '2026-09-10T03:16:00.000Z', sessionId: 'ses_edge', programId: 'demo' },
        { seq: 3, type: 'outcome_recorded', at: '2026-09-10T03:17:00.000Z', sessionId: 'ses_edge', outcome: { result: 'passed' } },
      ],
    };
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts }),
      sessions: fakeSessions(rows, events),
      clock,
      logger: silent,
    });
    const digest = await useCase.execute();
    expect(digest[0].attemptsToday).toBe(1);
    expect(digest[0].sessionsToday).toEqual([
      expect.objectContaining({ unitId: 'frac.01', state: 'outcome_recorded', studyDay: '2026-09-09' }),
    ]);
  });

  it('a 02:00Z attempt is NOT counted after the boundary rolls at 04:30Z — same raw date as "today", but before the boundary so it is YESTERDAY\'s study day', async () => {
    // At 04:30Z on the 10th the window has just rolled to [04:00Z the 10th,
    // 04:00Z the 11th). The attempt at 02:00Z on the 10th shares its raw
    // day-file date ("2026-09-10") with "today", but happened before 04:00Z,
    // so it belongs to the PREVIOUS study day. A naive single-date lookup on
    // "2026-09-10" would wrongly include it.
    const clock = () => new Date('2026-09-10T04:30:00.000Z');
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    const attempts = { kid1: [{ at: '2026-09-10T02:00:00.000Z', correct: true }] };
    const rows = [sessionRow({ sessionId: 'ses_before', unitId: 'frac.01', updatedAt: '2026-09-10T02:00:00.000Z' })];
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts }),
      sessions: fakeSessions(rows),
      clock,
      logger: silent,
    });
    const digest = await useCase.execute();
    expect(digest[0].attemptsToday).toBe(0);
    expect(digest[0].sessionsToday).toEqual([]);
  });

  it('cannot be built without learnerDirectory/datastore/sessions', () => {
    expect(() => new GetTeacherToday({})).toThrow(/learnerDirectory/);
  });
});
