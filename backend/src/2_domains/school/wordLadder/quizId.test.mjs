import { describe, expect, it } from 'vitest';
import {
  deckDirOf, isoWeekOf, learnerQuizDocumentId, learnerQuizPrefix, parseLearnerQuizId, quizDocumentIdFor,
} from './index.mjs';

describe('quizDocumentIdFor', () => {
  it('suffixes the deck id with -quiz', () => {
    expect(quizDocumentIdFor('language/korean/week-01-classroom')).toBe('language/korean/week-01-classroom-quiz');
  });
});

describe('per-learner ids (plan 3, spec §8)', () => {
  it('deckDirOf, isoWeekOf, learnerQuizDocumentId, learnerQuizPrefix', () => {
    expect(deckDirOf('language/korean/week-01-classroom')).toBe('language/korean');
    expect(isoWeekOf('2026-09-22')).toBe('2026-W39'); // display / --week input shape — kept uppercase
    // The id itself lowercases the week: it is a kebab-case document id
    // segment (documentValidation.mjs's ID_PATTERN is lowercase-only).
    expect(learnerQuizDocumentId({
      deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'test-learner', isoWeek: '2026-W39',
    })).toBe('language/korean/korean-vocab-quiz-test-learner-2026-w39');
    expect(learnerQuizPrefix({ deckDir: 'language/korean', pkg: 'korean-vocab' })).toBe('language/korean/korean-vocab-quiz-');
    expect(learnerQuizPrefix({ deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'test-learner' }))
      .toBe('language/korean/korean-vocab-quiz-test-learner-');
  });
  it('isoWeekOf handles year boundaries (ISO week, not calendar week)', () => {
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
    expect(isoWeekOf('2026-12-31')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
  });
});

describe('parseLearnerQuizId (fix round 1 — segment-bounded, not a raw startsWith prefix)', () => {
  const ctx = { deckDir: 'language/korean', pkg: 'korean-vocab' };

  it('round-trips learnerQuizDocumentId', () => {
    const id = learnerQuizDocumentId({ ...ctx, learnerId: 'test-learner', isoWeek: '2026-W39' });
    expect(parseLearnerQuizId(id, ctx)).toEqual({ learnerId: 'test-learner', isoWeek: '2026-w39' });
  });

  it('a learnerId may itself contain hyphens — the trailing week token anchors the split, not the first hyphen', () => {
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a-b-2026-w39', ctx)).toEqual({ learnerId: 'a-b', isoWeek: '2026-w39' });
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a-2026-w39', ctx)).toEqual({ learnerId: 'a', isoWeek: '2026-w39' });
  });

  it('learner "a" is never confused with learner "a-b" — a raw startsWith prefix would wrongly match', () => {
    // '…-quiz-a-' IS a startsWith-prefix of '…-quiz-a-b-2026-w39' — the old bug.
    const abDoc = 'language/korean/korean-vocab-quiz-a-b-2026-w39';
    expect(parseLearnerQuizId(abDoc, ctx)?.learnerId).toBe('a-b');
    expect(parseLearnerQuizId(abDoc, ctx)?.learnerId).not.toBe('a');
  });

  it('returns null for a different deckDir/pkg, the legacy per-deck id, or a malformed week', () => {
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a-2026-w39', { deckDir: 'language/spanish', pkg: 'korean-vocab' })).toBeNull();
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a-2026-w39', { deckDir: 'language/korean', pkg: 'other-pkg' })).toBeNull();
    expect(parseLearnerQuizId('language/korean/week-01-classroom-quiz', ctx)).toBeNull(); // legacy per-deck id
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a', ctx)).toBeNull(); // no week at all
    expect(parseLearnerQuizId('language/korean/korean-vocab-quiz-a-2026-99', ctx)).toBeNull(); // not a week shape
  });
});
