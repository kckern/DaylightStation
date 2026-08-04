import { describe, expect, it } from 'vitest';
import { aggregateLearningProgress, validateLearningEvidence } from './learningProgress.mjs';
import { createLearningReflectionEvidence } from './learningReflection.mjs';
import { normalizeSelfRegulation } from './selfRegulation.mjs';

const base = {
  evidenceId: 'reflect-1', learnerId: 'kid-a', occurredAt: '2026-08-02T12:00:00.000Z',
  activity: { id: 'fractions-check', sessionId: 'session-1', itemId: 'q1' },
  learning: { subjectId: 'math', courseId: 'fractions', conceptIds: ['equivalence'] },
};

describe('School self-regulation evidence', () => {
  it('creates an optional reflection that remains separate from academic accuracy', () => {
    const reflection = createLearningReflectionEvidence({
      ...base,
      selfRegulation: {
        phase: 'self_reflection', confidence: 2, selfAssessment: 'not_yet',
        errorCategoryId: 'concept', strategyIds: ['worked-examples'],
        nextAction: { type: 'lesson', id: 'equivalent-fractions-review' },
      },
    });
    expect(reflection).toMatchObject({
      verification: 'self_reported',
      activity: { kind: 'reflection', graded: false },
      measures: { engagements: 1, responses: 0, correct: 0 },
      selfRegulation: { phase: 'self_reflection', confidence: 2 },
    });
    const progress = aggregateLearningProgress({
      evidence: [reflection],
      scope: { type: 'learner', id: 'kid-a', label: 'Kid A', learnerIds: ['kid-a'] },
      generatedAt: '2026-08-02T13:00:00.000Z',
    });
    expect(progress.summary).toMatchObject({ responseCount: 0, correctCount: 0, scorePercent: null });
    expect(progress.selfRegulation).toMatchObject({
      evidenceCount: 1,
      phaseCounts: { self_reflection: 1 },
      confidence: { self_reflection: { count: 1, average: 2 } },
      errorCategories: [{ id: 'concept', evidenceCount: 1 }],
      strategies: [{ id: 'worked-examples', evidenceCount: 1 }],
    });
  });

  it('supports each phase but rejects empty, ranking-shaped, or unbounded observations', () => {
    expect(normalizeSelfRegulation({ phase: 'forethought', confidence: 4 }).errors).toEqual([]);
    expect(normalizeSelfRegulation({ phase: 'performance', selfAssessment: 'uncertain' }).errors).toEqual([]);
    expect(normalizeSelfRegulation({ phase: 'self_reflection' }).errors)
      .toContain('selfRegulation: must contain at least one observation');
    expect(normalizeSelfRegulation({ phase: 'self_reflection', abilityTier: 'low' }).errors)
      .toEqual(expect.arrayContaining([
        'selfRegulation: unknown fields abilityTier',
        'selfRegulation: must contain at least one observation',
      ]));
    expect(normalizeSelfRegulation({ phase: 'forethought', confidence: 6 }).errors)
      .toContain('selfRegulation.confidence: must be an integer from 1 to 5');
  });

  it('validates the optional envelope on evidence from any surface', () => {
    const result = validateLearningEvidence({
      schema: 'school.learning-evidence/v1',
      evidenceId: 'voice-reflection', learnerId: 'kid-a', occurredAt: base.occurredAt,
      verification: 'self_reported',
      activity: { id: 'reading', kind: 'reflection', graded: false },
      learning: { courseId: 'reading' },
      measures: { engagements: 1 },
      source: { surface: 'paper', transport: 'scan' },
      selfRegulation: { phase: 'self_reflection', note: 'I rushed the directions.' },
    });
    expect(result.errors).toEqual([]);
    expect(result.evidence.selfRegulation.note).toBe('I rushed the directions.');
  });
});

