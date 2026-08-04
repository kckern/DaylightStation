import { describe, expect, it, vi } from 'vitest';
import { GetInstructionalInsights } from './GetInstructionalInsights.mjs';

const evidence = (overrides = {}) => ({
  schema: 'school.learning-evidence/v1', evidenceId: 'answer-1', learnerId: 'kid-a',
  occurredAt: '2026-08-01T12:00:00.000Z', verification: 'verified',
  activity: { id: 'check', kind: 'quiz', itemId: 'q1', graded: true },
  learning: { courseId: 'course-a', unitId: 'unit-a', conceptIds: ['concept-a'] },
  measures: { engagements: 1, responses: 1, correct: 0 },
  source: { surface: 'web', transport: 'screen' },
  ...overrides,
});

function fixture() {
  const firstSource = { listEvidence: vi.fn(async () => [evidence()]) };
  const secondSource = { listEvidence: vi.fn(async () => [evidence({
    evidenceId: 'answer-2', learnerId: 'kid-b',
  })]) };
  const cohortDirectory = {
    resolveScope: vi.fn(async () => ({
      type: 'classroom', id: 'class-a', label: 'Class A', learnerIds: ['kid-a', 'kid-b'],
    })),
  };
  const expectationSource = { listExpectations: vi.fn(async () => [{
    schema: 'school.learning-expectation/v1', expectationId: 'unit-a-due',
    scopeType: 'classroom', scopeId: 'class-a', target: { kind: 'unit', id: 'unit-a' },
    dueAt: '2026-08-02T00:00:00.000Z', expectedCompletedPercent: 100,
  }]) };
  return {
    firstSource,
    expectationSource,
    useCase: new GetInstructionalInsights({
      evidenceSources: [firstSource, secondSource], cohortDirectory, expectationSource,
      clock: () => new Date('2026-08-03T00:00:00.000Z'),
      policy: { accuracyThresholdPercent: 70, minimumResponses: 2 },
    }),
  };
}

describe('GetInstructionalInsights', () => {
  it('derives concept and pacing signals for an application-resolved cohort', async () => {
    const { useCase, firstSource, expectationSource } = fixture();
    const result = await useCase.execute({
      scopeType: 'classroom', scopeId: 'class-a',
      from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
    });

    expect(firstSource.listEvidence).toHaveBeenCalledWith({
      learnerIds: ['kid-a', 'kid-b'],
      from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
    });
    expect(expectationSource.listExpectations).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ type: 'classroom', id: 'class-a' }),
    }));
    expect(result).toMatchObject({
      summary: { learnerCount: 2, conceptsNeedingInstructionalReview: 1, pacingReviewCount: 1 },
      scope: { type: 'classroom', id: 'class-a' },
      policy: {
        recommendationVersion: 'school.instructional-review/v1',
        recommendationExpiresAt: '2026-08-10T00:00:00.000Z',
      },
      concepts: [{ target: { kind: 'concept', id: 'concept-a' }, signal: 'review_instruction' }],
      pacing: [{ expectationId: 'unit-a-due', status: 'review_pacing' }],
      constraints: { learnerRanking: false, permanentAbilityLabels: false },
    });
    expect(result.concepts[0].suggestedAction.recommendation).toMatchObject({
      basis: { kind: 'evidence_aggregate', evidenceCount: 2, learnerCount: 2 },
      policy: { expiresAt: '2026-08-10T00:00:00.000Z' },
    });
  });

  it('returns not-found for an unknown cohort instead of guessing membership', async () => {
    const missing = new GetInstructionalInsights({
      evidenceSources: [{ listEvidence: async () => [] }],
      cohortDirectory: { resolveScope: async () => null },
    });
    await expect(missing.execute({ scopeType: 'classroom', scopeId: 'missing' })).rejects.toThrow(/not found/i);
  });
});
