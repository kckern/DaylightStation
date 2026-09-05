import { describe, expect, it } from 'vitest';
import {
  chooseReadingProgram,
  defaultReadingEnrollment,
  describeReadingEnrollment,
  readingEnrollments,
} from './readingPrograms.js';

describe('reading program assignment model', () => {
  it('finds an invalid legacy double-enrollment instead of hiding it', () => {
    expect(readingEnrollments([
      { programId: 'story-time' },
      { programId: 'flashcards' },
      { programId: 'book-log' },
    ])).toHaveLength(2);
  });

  it('switches reading experiences while preserving every unrelated enrollment object', () => {
    const language = { programId: 'sentence-ladder', corpusId: 'korean', policy: { daily: 10 } };
    const programs = [language, { programId: 'story-time', target: 4 }];
    const next = chooseReadingProgram(programs, 'book-log');

    expect(next[0]).toBe(language);
    expect(next).toEqual([language, defaultReadingEnrollment('book-log')]);
  });

  it('keeps a selected existing enrollment intact, including custom policy', () => {
    const bookLog = {
      programId: 'book-log', subject: 'english',
      obligation: { metric: 'pages', quantity: 20, per: 'day' },
      schedule: { daysOfWeek: [1, 3, 5] },
    };
    expect(chooseReadingProgram([bookLog], 'book-log')[0]).toBe(bookLog);
  });

  it('can explicitly remove reading without touching other programs', () => {
    expect(chooseReadingProgram([
      { programId: 'story-time' },
      { programId: 'flashcards', deckId: 'science/cells' },
    ], null)).toEqual([{ programId: 'flashcards', deckId: 'science/cells' }]);
  });

  it('summarizes the policy an adult is actually saving', () => {
    expect(describeReadingEnrollment({ programId: 'story-time', target: 1 })).toBe('1 story on each scheduled day');
    expect(describeReadingEnrollment({
      programId: 'book-log', obligation: { metric: 'checkins', quantity: 1, per: 'day' },
    })).toBe('1 reading check-in per day');
    expect(describeReadingEnrollment({
      programId: 'book-log', obligation: { metric: 'pages', quantity: 20, per: 'day' },
    })).toBe('20 pages per day');
  });
});
