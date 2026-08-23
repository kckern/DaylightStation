import { describe, it, expect } from 'vitest';
import { validateProgramEnrollment } from './programEnrollment.mjs';

const corpus = {
  id: 'glossika-korean', size: 100,
  banks: [{ id: 'fluency-1', label: 'Fluency 1', range: [1, 50] }],
};

describe('validateProgramEnrollment', () => {
  it('normalizes a valid per-learner policy', () => {
    expect(validateProgramEnrollment({
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 10,
      rungs: ['repetition'], scope: ['fluency-1'], reward: { amount: 2 },
    }, { corpus })).toEqual({ errors: [], enrollment: {
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 10,
      rungs: ['repetition'], unitSize: 10, scope: ['fluency-1'], reward: { amount: 2 },
    } });
  });

  it('rejects signoff rewards and out-of-bounds ranges', () => {
    const result = validateProgramEnrollment({
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 1,
      reward: { amount: 1, requiresSignoff: true }, scope: [{ range: [99, 101] }],
    }, { corpus });
    expect(result.errors).toEqual(expect.arrayContaining([
      'program rewards cannot require signoff',
      'scope entries must be known bank ids or bounded integer ranges',
    ]));
  });
});
