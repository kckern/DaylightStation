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

function fakeAssignments(historyByLearner = {}) {
  return {
    history: async (learnerId) => historyByLearner[learnerId] ?? [],
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
    readAttemptsInRange(learnerId, fromDay, toDay) {
      return (attempts[learnerId] ?? []).filter((a) => {
        const day = String(a.at).slice(0, 10);
        return day >= fromDay && day <= toDay;
      });
    },
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
    day,
    updatedAt,
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
    const clock = () => new Date('2026-09-10T10:00:00.000Z'); // well after the 4am boundary -> today is 2026-09-10
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    const attempts = {
      kid1: [
        { at: '2026-09-10T09:00:00.000Z', correct: true },
        { at: '2026-09-10T09:05:00.000Z', correct: false },
        { at: '2026-09-09T23:00:00.000Z', correct: true }, // yesterday — must NOT count
      ],
    };
    const rows = [
      sessionRow({
        sessionId: 'ses_today', unitId: 'frac.01', state: 'in_progress', terminal: false, day: '2026-09-10', updatedAt: '2026-09-10T09:00:00.000Z',
      }),
      sessionRow({
        sessionId: 'ses_yesterday', unitId: 'frac.02', state: 'outcome_recorded', day: '2026-09-09', updatedAt: '2026-09-09T09:00:00.000Z',
      }),
    ];
    const reviewQueue = { listPending: async () => [{ learnerId: 'kid1', itemId: 'q1' }] };
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts }),
      sessions: fakeSessions(rows),
      reviewQueue,
      clock,
      logger: silent,
    });

    const digest = await useCase.execute();
    expect(digest).toEqual([{
      learnerId: 'kid1',
      attemptsToday: 2,
      correctToday: 1,
      sessionsToday: [{ unitId: 'frac.01', state: 'in_progress' }],
      pendingReview: 1,
    }]);
  });

  it('a session created just before the 4am boundary still belongs to YESTERDAY\'s digest', async () => {
    // 03:30 UTC — before the 4am rollover, so "today" is still the PREVIOUS calendar day.
    const clock = () => new Date('2026-09-10T03:30:00.000Z');
    const learnerDirectory = { listLearners: () => ROSTER.filter((r) => r.id === 'kid1') };
    const rows = [
      sessionRow({
        sessionId: 'ses_late', unitId: 'frac.01', day: '2026-09-09', updatedAt: '2026-09-10T03:15:00.000Z',
      }),
    ];
    const useCase = new GetTeacherToday({
      learnerDirectory,
      datastore: fakeSchoolDatastore({ attempts: {} }),
      sessions: fakeSessions(rows),
      clock,
      logger: silent,
    });
    const digest = await useCase.execute();
    expect(digest[0].sessionsToday).toEqual([{ unitId: 'frac.01', state: 'outcome_recorded' }]);
  });

  it('cannot be built without learnerDirectory/datastore/sessions', () => {
    expect(() => new GetTeacherToday({})).toThrow(/learnerDirectory/);
  });
});
