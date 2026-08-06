import { describe, expect, it } from 'vitest';
import {
  aggregateLearningProgress,
  deriveAssessmentReviewFollowUps,
  normalizeFollowUpAction,
  normalizeLearningScope,
  validateAcademicPeriod,
  validateLearningEvidence,
} from './learningProgress.mjs';

const evidence = (over = {}) => ({
  schema: 'school.learning-evidence/v1',
  evidenceId: 'att-1', learnerId: 'kid-a',
  occurredAt: '2026-08-01T12:00:00.000Z',
  verification: 'verified',
  activity: { id: 'fractions-check', kind: 'quiz', sessionId: 'quiz-1', itemId: 'q1', graded: true },
  learning: {
    subjectId: 'math', areaIds: ['quantitative'], courseId: 'fractions',
    unitId: 'equivalence', lessonId: 'halves', moduleId: 'check',
    conceptIds: ['equivalent-fractions'], classifications: ['core'], tags: ['number'],
  },
  measures: { engagements: 1, responses: 1, correct: 1 },
  source: { surface: 'web', transport: 'screen' },
  ...over,
});

const scope = {
  type: 'household', id: 'home', label: 'Household', learnerIds: ['kid-a', 'kid-b'],
};

describe('learning evidence', () => {
  it('normalizes a subject-neutral evidence record with reusable dimensions', () => {
    expect(validateLearningEvidence(evidence())).toMatchObject({
      errors: [],
      evidence: { learning: { subjectId: 'math', classifications: ['core'] } },
    });
  });

  it('rejects impossible measures and noncanonical time', () => {
    expect(validateLearningEvidence(evidence({
      occurredAt: 'yesterday', measures: { responses: 1, correct: 2 },
    })).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/canonical ISO-8601/),
      expect.stringMatching(/cannot exceed responses/),
    ]));
  });
});

describe('scope and academic time', () => {
  it('supports learner and arbitrary cohort types without putting membership policy in the domain', () => {
    expect(normalizeLearningScope(scope)).toMatchObject({ errors: [], scope });
    expect(normalizeLearningScope({ ...scope, type: 'classroom', id: 'algebra-1' }).errors).toEqual([]);
    expect(normalizeLearningScope({ ...scope, type: 'learner' }).errors).toContain(
      'scope.learnerIds: learner scope must resolve exactly one learner',
    );
  });

  it('models term, semester, season, or future period names as configured data', () => {
    const period = {
      schema: 'school.academic-period/v1', periodId: 'fall-2026', kind: 'semester', label: 'Fall 2026',
      startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-20T00:00:00.000Z',
    };
    expect(validateAcademicPeriod(period)).toMatchObject({ errors: [], period });
    expect(validateAcademicPeriod({ ...period, kind: 'season', periodId: 'autumn' }).errors).toEqual([]);
  });
});

describe('progress aggregation', () => {
  const rows = [
    evidence(),
    evidence({
      evidenceId: 'att-2', occurredAt: '2026-08-01T12:00:01.000Z',
      activity: { id: 'fractions-check', kind: 'quiz', sessionId: 'quiz-1', itemId: 'q2', graded: true },
      measures: { engagements: 1, responses: 1, correct: 0 },
    }),
    evidence({
      evidenceId: 'att-3', learnerId: 'kid-b', occurredAt: '2026-08-02T12:00:00.000Z',
      verification: 'pending',
      activity: { id: 'economics-check', kind: 'quiz', sessionId: 'quiz-2', itemId: 'q1', graded: true },
      learning: { subjectId: 'economics', areaIds: ['social-studies'], classifications: ['elective'] },
      measures: { engagements: 1, responses: 1, correct: 1 },
      source: { surface: 'calculator', transport: 'offline' },
    }),
  ];

  it('returns exact scores, recent assessments, facets, and multidimensional rollups', () => {
    const out = aggregateLearningProgress({
      evidence: rows, scope, generatedAt: '2026-08-03T00:00:00.000Z',
      groupBy: ['learner', 'subject'],
    });
    expect(out.summary).toMatchObject({
      responseCount: 3, correctCount: 2, scorePercent: 67,
      assessmentCount: 2, pendingCount: 1,
    });
    expect(out.selfRegulation).toMatchObject({ evidenceCount: 0 });
    expect(out.recentScores).toEqual(expect.arrayContaining([
      expect.objectContaining({ assessmentId: 'quiz-1', score: { correct: 1, total: 2, percent: 50 } }),
    ]));
    expect(out.breakdowns.map((row) => row.key)).toEqual([
      'learner=kid-a|subject=math', 'learner=kid-b|subject=economics',
    ]);
    expect(out.facets.classifications.map((row) => row.id)).toEqual(['core', 'elective']);
  });

  it('two attempts from one printed card group into ONE recent-score assessment, not two singletons', () => {
    const cardEntry = (evidenceId, itemId, correct, occurredAt) => evidence({
      evidenceId,
      occurredAt,
      activity: {
        id: 'fractions-check', kind: 'quiz', assessmentId: 'math/q@abc:v0:1-2', itemId, graded: true,
      },
      measures: { engagements: 1, responses: 1, correct: correct ? 1 : 0 },
    });
    const rows = [
      cardEntry('att-10', 'q1', true, '2026-08-01T12:00:00.000Z'),
      cardEntry('att-11', 'q2', false, '2026-08-01T12:00:01.000Z'),
    ];
    const out = aggregateLearningProgress({ evidence: rows, scope, generatedAt: '2026-08-03T00:00:00.000Z' });
    expect(out.recentScores).toHaveLength(1);
    expect(out.recentScores[0]).toMatchObject({
      assessmentId: 'math/q@abc:v0:1-2', score: { correct: 1, total: 2, percent: 50 },
    });
  });

  it('builds a stable evidence-backed course/unit/lesson/module history without inventing completion', () => {
    const out = aggregateLearningProgress({
      evidence: rows, scope, generatedAt: '2026-08-03T00:00:00.000Z',
    });
    const math = out.curriculumHistory.roots.find((node) => node.id === 'math');
    expect(out.curriculumHistory.hierarchy).toEqual([
      'catalog', 'subject', 'course', 'unit', 'lesson', 'module',
    ]);
    expect(math).toMatchObject({
      key: 'subject=math', kind: 'subject', id: 'math', evidenceState: 'recorded',
      directEvidenceCount: 0,
      summary: { evidenceCount: 2, responseCount: 2, scorePercent: 50 },
    });
    expect(math.children[0]).toMatchObject({
      key: 'subject=math|course=fractions', kind: 'course', id: 'fractions',
      summary: { evidenceCount: 2 },
    });
    expect(math.children[0].children[0].children[0].children[0]).toMatchObject({
      kind: 'module', id: 'check', directEvidenceCount: 2,
    });
    expect(math).not.toHaveProperty('complete');
    expect(math).not.toHaveProperty('completionState');
    expect(out.curriculumHistory.unscoped).toMatchObject({ evidenceCount: 0 });
  });

  it('annotates a fully-evidenced unit with the curriculum-backed outline, without fabricating untouched units (Task 11)', () => {
    const outlineExpectation = (over = {}) => ({
      schema: 'school.learning-expectation/v1', scopeType: 'household', scopeId: 'home',
      dueAt: '9999-12-31T00:00:00.000Z', expectedCompletedPercent: 100, ...over,
    });
    const expectations = [
      outlineExpectation({
        expectationId: 'outline-fractions-equivalence', target: { kind: 'unit', id: 'equivalence' },
      }),
      // 'decimals' has zero evidence in `rows` — an authored-but-untouched unit.
      outlineExpectation({
        expectationId: 'outline-fractions-decimals', target: { kind: 'unit', id: 'decimals' },
      }),
    ];
    const out = aggregateLearningProgress({
      evidence: rows, scope, generatedAt: '2026-08-03T00:00:00.000Z', expectations,
    });

    const math = out.curriculumHistory.roots.find((node) => node.id === 'math');
    const unitNode = math.children[0].children[0];
    expect(unitNode).toMatchObject({
      kind: 'unit', id: 'equivalence',
      outline: {
        expectationId: 'outline-fractions-equivalence', dueAt: '9999-12-31T00:00:00.000Z',
        expectedCompletedPercent: 100,
      },
    });
    // The untouched unit is never nested into the tree under an ancestry the
    // bare expectation can't supply — it is named honestly as outstanding.
    expect(out.curriculumHistory.outstanding).toEqual([
      expect.objectContaining({
        expectationId: 'outline-fractions-decimals', target: { kind: 'unit', id: 'decimals' },
      }),
    ]);
  });

  it('preserves partially classified and unscoped evidence in curriculum history totals', () => {
    const partial = evidence({
      evidenceId: 'partial', activity: { id: 'read', kind: 'notes' },
      learning: { courseId: 'independent-study' }, measures: { engagements: 1 },
    });
    const unscoped = evidence({
      evidenceId: 'unscoped', activity: { id: 'free-practice', kind: 'practice' },
      learning: {}, measures: { engagements: 1 },
    });
    const out = aggregateLearningProgress({
      evidence: [partial, unscoped], scope, generatedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(out.curriculumHistory.roots).toEqual([
      expect.objectContaining({ kind: 'course', id: 'independent-study', directEvidenceCount: 1 }),
    ]);
    expect(out.curriculumHistory.unscoped).toMatchObject({ evidenceCount: 1, engagementCount: 1 });
    expect(out.summary.evidenceCount).toBe(2);
  });

  it('slices by half-open time, subject/area, and include/exclude classification', () => {
    const out = aggregateLearningProgress({
      evidence: rows, scope, generatedAt: '2026-08-03T00:00:00.000Z',
      window: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
      filters: {
        subjectIds: ['math'], areaIds: ['quantitative'], excludeClassifications: ['elective'],
      },
      groupBy: ['day'],
    });
    expect(out.summary).toMatchObject({ evidenceCount: 2, correctCount: 1, responseCount: 2, scorePercent: 50 });
    expect(out.breakdowns[0].dimensions).toEqual({ day: '2026-08-01' });
  });

  it('never conflates self-reported practice with verified assessment accuracy', () => {
    const card = evidence({
      evidenceId: 'card-1', verification: 'self_reported',
      activity: { id: 'cards', kind: 'flashcards', sessionId: 'cards-1', graded: false },
      measures: { engagements: 1 },
    });
    const out = aggregateLearningProgress({
      evidence: [rows[0], card], scope, generatedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(out.summary).toMatchObject({ engagementCount: 2, responseCount: 1, correctCount: 1, scorePercent: 100 });
    expect(out.summary.selfReportedCount).toBe(1);
  });

  it('carries generic follow-up actions without knowing a subject or surface route', () => {
    const action = {
      actionId: 'review:quiz-1', learnerId: 'kid-a', kind: 'review', label: 'Review this quiz',
      availability: 'ready', target: { type: 'assessment', id: 'quiz-1' }, priority: 20,
    };
    expect(normalizeFollowUpAction(action)).toMatchObject({ errors: [], action });
    const out = aggregateLearningProgress({
      evidence: rows, scope, followUps: [action], generatedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(out.followUps).toEqual([action]);
  });

  it('offers review for the latest below-threshold assessment without guessing curriculum order', () => {
    expect(deriveAssessmentReviewFollowUps(rows, { thresholdPercent: 80 })).toEqual([
      expect.objectContaining({
        learnerId: 'kid-a', kind: 'review', target: { type: 'bank', id: 'fractions-check' },
      }),
    ]);
  });
});
