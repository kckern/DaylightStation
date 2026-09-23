import { describe, expect, it } from 'vitest';
import {
  deckDirOf, isoWeekOf, learnerQuizDocumentId, learnerQuizPrefix, quizDocumentIdFor,
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
