import { describe, expect, it } from 'vitest';
import { learningEvidenceFromAttempt } from './attemptEvidence.mjs';

const attempt = (over = {}) => ({
  id: 'att-1', at: '2026-08-02T12:00:00.000Z', sessionId: 'session-1',
  bankId: 'math/fractions/check', itemId: 'q1', itemType: 'multiple_choice',
  mode: 'quiz', correct: true, attributedTo: 'kid-a', transport: 'screen',
  learning: { courseId: 'fractions', conceptIds: ['equivalence'] },
  ...over,
});

describe('attempt progress evidence', () => {
  it('maps graded answers to verified accuracy and retains curriculum dimensions', () => {
    expect(learningEvidenceFromAttempt(attempt())).toMatchObject({
      learnerId: 'kid-a', verification: 'verified',
      activity: { id: 'math/fractions/check', graded: true },
      learning: { subjectId: 'math', courseId: 'fractions', conceptIds: ['equivalence'] },
      measures: { engagements: 1, responses: 1, correct: 1 },
      source: { surface: 'web', transport: 'screen' },
    });
  });

  it('keeps flashcard self-reports out of accuracy', () => {
    expect(learningEvidenceFromAttempt(attempt({ mode: 'flashcard', correct: true }))).toMatchObject({
      verification: 'self_reported', activity: { graded: false },
      measures: { engagements: 1, responses: 0, correct: 0 },
    });
  });

  it('preserves calculator provenance without making the model TI-specific', () => {
    expect(learningEvidenceFromAttempt(attempt({
      transport: 'calculator',
      provenance: { schoolCalc: { deviceId: '86A001' } },
    })).source).toEqual({ surface: 'calculator', transport: 'calculator', deviceId: '86A001' });
  });
});

