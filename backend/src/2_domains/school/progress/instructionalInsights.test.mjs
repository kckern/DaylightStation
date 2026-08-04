import { describe, expect, it } from 'vitest';
import {
  deriveInstructionalInsights,
  validateLearningExpectation,
} from './instructionalInsights.mjs';

const evidence = ({
  id, learnerId, correct, conceptId = 'equivalence', itemId = 'q1',
  lessonId = 'fractions', completions = 0, at = '2026-08-02T12:00:00.000Z',
}) => ({
  schema: 'school.learning-evidence/v1', evidenceId: id, learnerId, occurredAt: at,
  verification: 'verified',
  activity: { id: 'fraction-probe', kind: 'learning_probe', sessionId: `${learnerId}-probe`, itemId, graded: true },
  learning: { courseId: 'numbers', lessonId, conceptIds: [conceptId] },
  measures: { engagements: 1, responses: 1, correct: correct ? 1 : 0, completions },
  source: { surface: 'web', transport: 'screen' },
});

const policy = {
  version: 'school.instructional-review/v1',
  expiresAt: '2026-08-10T00:00:00.000Z',
};
const scope = { type: 'classroom', id: 'group-1' };

describe('instructional insights', () => {
  it('identifies content needing instructional review without ranking learners', () => {
    const insight = deriveInstructionalInsights({
      learnerIds: ['kid-a', 'kid-b'],
      evidence: [
        evidence({ id: 'a1', learnerId: 'kid-a', correct: false }),
        evidence({ id: 'b1', learnerId: 'kid-b', correct: true }),
        evidence({ id: 'a2', learnerId: 'kid-a', correct: false, itemId: 'q2' }),
      ],
      asOf: '2026-08-03T00:00:00.000Z',
      scope,
      recommendationPolicy: policy,
      accuracyThresholdPercent: 70,
      minimumResponses: 2,
    });
    expect(insight.summary).toMatchObject({
      learnerCount: 2, assessedResponseCount: 3,
      conceptsNeedingInstructionalReview: 1,
    });
    expect(insight.concepts[0]).toMatchObject({
      target: { kind: 'concept', id: 'equivalence' },
      signal: 'review_instruction', responseCount: 3, correctCount: 1,
      incorrectCount: 2, accuracyPercent: 33, affectedLearnerIds: ['kid-a'],
      suggestedAction: { kind: 'review_instruction' },
    });
    expect(insight.concepts[0].suggestedAction.recommendation).toMatchObject({
      audience: 'adult', scope,
      basis: {
        kind: 'evidence_aggregate', evidenceCount: 3, responseCount: 3,
        correctCount: 1, learnerCount: 2,
      },
      policy: {
        version: policy.version, expiresAt: policy.expiresAt,
        reassessOnNewEvidence: true,
      },
      constraints: {
        learnerRanking: false, permanentAbilityLabels: false, fixedPlacement: false,
      },
    });
    expect(insight.constraints).toEqual({
      learnerRanking: false,
      permanentAbilityLabels: false,
      pacingRequiresAuthoredExpectations: true,
    });
    expect(insight).not.toHaveProperty('rankings');
  });

  it('does not overstate sparse evidence', () => {
    const insight = deriveInstructionalInsights({
      learnerIds: ['kid-a'],
      evidence: [evidence({ id: 'a1', learnerId: 'kid-a', correct: false })],
      asOf: '2026-08-03T00:00:00.000Z', minimumResponses: 2,
      scope,
      recommendationPolicy: policy,
    });
    expect(insight.concepts[0]).toMatchObject({ signal: 'limited_evidence' });
    expect(insight.concepts[0]).not.toHaveProperty('suggestedAction');
  });

  it('removes a prior review suggestion when new evidence changes the aggregate', () => {
    const initial = [
      evidence({ id: 'a1', learnerId: 'kid-a', correct: false }),
      evidence({ id: 'a2', learnerId: 'kid-a', correct: false, itemId: 'q2' }),
      evidence({ id: 'b1', learnerId: 'kid-b', correct: true, itemId: 'q3' }),
    ];
    const options = {
      learnerIds: ['kid-a', 'kid-b'], asOf: '2026-08-03T00:00:00.000Z',
      scope, recommendationPolicy: policy, accuracyThresholdPercent: 70, minimumResponses: 2,
    };
    expect(deriveInstructionalInsights({ ...options, evidence: initial }).concepts[0])
      .toHaveProperty('suggestedAction');
    const updated = [...initial,
      evidence({ id: 'a3', learnerId: 'kid-a', correct: true, itemId: 'q4' }),
      evidence({ id: 'a4', learnerId: 'kid-a', correct: true, itemId: 'q5' }),
      evidence({ id: 'b2', learnerId: 'kid-b', correct: true, itemId: 'q6' }),
      evidence({ id: 'b3', learnerId: 'kid-b', correct: true, itemId: 'q7' }),
    ];
    const refreshed = deriveInstructionalInsights({ ...options, evidence: updated });
    expect(refreshed.concepts[0]).toMatchObject({ signal: 'monitor', accuracyPercent: 71 });
    expect(refreshed.concepts[0]).not.toHaveProperty('suggestedAction');
  });

  it('derives pacing only from an explicit authored expectation', () => {
    const expectation = {
      schema: 'school.learning-expectation/v1', expectationId: 'fractions-by-friday',
      scopeType: 'classroom', scopeId: 'group-1',
      target: { kind: 'lesson', id: 'fractions' },
      dueAt: '2026-08-03T00:00:00.000Z', expectedCompletedPercent: 100,
    };
    expect(validateLearningExpectation(expectation).errors).toEqual([]);
    const insight = deriveInstructionalInsights({
      learnerIds: ['kid-a', 'kid-b'], expectations: [expectation],
      evidence: [
        evidence({ id: 'a1', learnerId: 'kid-a', correct: true, completions: 1 }),
        evidence({ id: 'b1', learnerId: 'kid-b', correct: true }),
      ],
      asOf: '2026-08-04T00:00:00.000Z',
      scope,
      recommendationPolicy: policy,
    });
    expect(insight.pacing).toEqual([expect.objectContaining({
      expectationId: 'fractions-by-friday', completedPercent: 50,
      status: 'review_pacing',
      suggestedAction: expect.objectContaining({
        kind: 'review_pacing', target: { kind: 'lesson', id: 'fractions' },
      }),
    })]);
    expect(insight.pacing[0].suggestedAction.recommendation).toMatchObject({
      basis: {
        kind: 'authored_expectation', expectationId: 'fractions-by-friday',
        completedLearnerCount: 1, learnerCount: 2,
      },
      policy: { expiresAt: policy.expiresAt },
    });
  });

  it('rejects implicit or malformed pacing claims', () => {
    expect(validateLearningExpectation({
      schema: 'school.learning-expectation/v1', expectationId: 'bad',
      scopeType: 'household', scopeId: 'home', target: { kind: 'subject', id: 'math' },
      dueAt: 'soon', expectedCompletedPercent: 0,
    }).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/target/), expect.stringMatching(/dueAt/), expect.stringMatching(/expectedCompletedPercent/),
    ]));
  });
});
