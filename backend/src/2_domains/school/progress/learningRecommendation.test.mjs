import { describe, expect, it } from 'vitest';
import { createLearningRecommendation, isLearningRecommendationActive } from './learningRecommendation.mjs';

const base = {
  recommendationId: 'instruction:concept:fractions', audience: 'adult',
  scope: { type: 'classroom', id: 'class-a' },
  target: { kind: 'concept', id: 'equivalent-fractions' },
  actionKind: 'review_instruction',
  basis: {
    kind: 'evidence_aggregate', evidenceCount: 4, responseCount: 4,
    correctCount: 1, learnerCount: 2,
    firstEvidenceAt: '2026-08-01T00:00:00.000Z',
    lastEvidenceAt: '2026-08-02T00:00:00.000Z',
  },
  policyVersion: 'school.instructional-review/v1',
  generatedAt: '2026-08-03T00:00:00.000Z',
  expiresAt: '2026-08-10T00:00:00.000Z',
};

describe('learning recommendation', () => {
  it('is expiring, evidence-explained, and explicitly non-tracking', () => {
    const result = createLearningRecommendation(base);
    expect(result).toMatchObject({
      action: { kind: 'review_instruction', target: base.target },
      policy: {
        version: 'school.instructional-review/v1', expiresAt: '2026-08-10T00:00:00.000Z',
        reassessOnNewEvidence: true,
      },
      constraints: {
        learnerRanking: false, permanentAbilityLabels: false, fixedPlacement: false,
      },
    });
    expect(Object.isFrozen(result.basis)).toBe(true);
  });

  it('rejects permanent-placement shortcuts and non-expiring policy', () => {
    expect(() => createLearningRecommendation({
      ...base, basis: { ...base.basis, abilityTier: 'low' },
    })).toThrow(/unknown fields/);
    expect(() => createLearningRecommendation({ ...base, expiresAt: base.generatedAt }))
      .toThrow(/expiry/);
    expect(() => createLearningRecommendation({ ...base, abilityTier: 'low' }))
      .toThrow(/unknown fields/);
    expect(() => createLearningRecommendation({
      ...base, generatedAt: '2026-07-31T00:00:00.000Z',
    })).toThrow(/precede its evidence/);
  });

  it('expires at the policy boundary instead of becoming a durable placement', () => {
    const recommendation = createLearningRecommendation(base);
    expect(isLearningRecommendationActive(recommendation, { asOf: '2026-08-09T23:59:59.999Z' })).toBe(true);
    expect(isLearningRecommendationActive(recommendation, { asOf: '2026-08-10T00:00:00.000Z' })).toBe(false);
  });
});
