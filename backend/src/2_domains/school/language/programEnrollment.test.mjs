import { describe, it, expect } from 'vitest';
import { validateProgramEnrollment } from './programEnrollment.mjs';

const corpus = {
  id: 'glossika-korean', size: 100,
  bands: [{ id: 'fluency-1', label: 'Fluency 1', range: [1, 50] }],
};

describe('validateProgramEnrollment', () => {
  it('normalizes a valid per-learner policy', () => {
    expect(validateProgramEnrollment({
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 10,
      rungs: ['repetition'], dictationMode: 'copy', scope: ['fluency-1'], reward: { amount: 2 },
    }, { corpus })).toEqual({ errors: [], enrollment: {
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 10,
      rungs: ['repetition'], dictationMode: 'copy', scope: ['fluency-1'], reward: { amount: 2 },
    } });
  });

  // Units NAME where a learner is; `scope` and corpus `bands` SELECT what they
  // study. Both appear here so the two stay visibly separate.
  it('carries declared unit boundaries through, in order', () => {
    const { errors, enrollment } = validateProgramEnrollment({
      programId: 'sentence-ladder', corpusId: 'glossika-korean', lessonSize: 60,
      units: [{ from: 2001, label: 'Fluency 3' }, { from: 1, label: 'Fluency 1' }],
    }, { corpus });
    expect(errors).toEqual([]);
    expect(enrollment.units).toEqual([{ from: 1, label: 'Fluency 1' }, { from: 2001, label: 'Fluency 3' }]);
  });

  it('leaves an unpartitioned course with no units field at all, rather than an empty one', () => {
    const { enrollment } = validateProgramEnrollment({
      programId: 'sentence-ladder', corpusId: 'glossika-korean', lessonSize: 60,
    }, { corpus });
    expect(enrollment).not.toHaveProperty('units');
  });

  it.each([
    ['a boundary that is not a sentence number', [{ from: 0, label: 'Zero' }], /units\[0\]\.from/],
    ['a unit with no name', [{ from: 1 }], /units\[0\]\.label/],
    ['a blank name', [{ from: 1, label: '  ' }], /units\[0\]\.label/],
    ['two units starting in the same place', [{ from: 1, label: 'A' }, { from: 1, label: 'B' }], /share a starting sentence/],
    ['a mapping where a list belongs', { from: 1, label: 'A' }, /units must be a list/],
  ])('refuses %s rather than leaving sentences unnamed', (_label, units, message) => {
    const { errors } = validateProgramEnrollment({
      programId: 'sentence-ladder', corpusId: 'glossika-korean', lessonSize: 60, units,
    }, { corpus });
    expect(errors.some((error) => message.test(error))).toBe(true);
  });

  it('rejects an unknown dictation mode', () => {
    const result = validateProgramEnrollment({
      programId: 'sentence-ladder', corpusId: 'glossika-korean', lessonSize: 1,
      dictationMode: 'hint',
    }, { corpus });
    expect(result.errors).toContain('dictationMode must be listen or copy');
  });

  it('rejects signoff rewards and out-of-bounds ranges', () => {
    const result = validateProgramEnrollment({
      programId: 'language', corpusId: 'glossika-korean', lessonSize: 1,
      reward: { amount: 1, requiresSignoff: true }, scope: [{ range: [99, 101] }],
    }, { corpus });
    expect(result.errors).toEqual(expect.arrayContaining([
      'program rewards cannot require signoff',
      'scope entries must be known band ids or bounded integer ranges',
    ]));
  });
});
