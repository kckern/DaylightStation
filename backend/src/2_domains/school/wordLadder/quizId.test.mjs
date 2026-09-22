import { describe, expect, it } from 'vitest';
import { quizDocumentIdFor } from './index.mjs';

describe('quizDocumentIdFor', () => {
  it('suffixes the deck id with -quiz', () => {
    expect(quizDocumentIdFor('language/korean/week-01-classroom')).toBe('language/korean/week-01-classroom-quiz');
  });
});
