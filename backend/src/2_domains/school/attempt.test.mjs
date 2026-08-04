import { describe, expect, it } from 'vitest';
import { createAttempt } from './attempt.mjs';

const required = {
  at: '2026-08-01T15:00:00.000Z',
  sessionId: 'session-1',
  bankId: 'bank-1',
  itemId: 'item-1',
  itemType: 'multiple_choice',
  mode: 'quiz',
  given: 'B',
  correct: true,
  attributedTo: 'learner-a',
};

describe('School attempt event time', () => {
  it('uses the application-supplied canonical timestamp', () => {
    expect(createAttempt(required)).toMatchObject({ at: required.at, sessionId: 'session-1' });
  });

  it('does not manufacture a domain timestamp', () => {
    expect(() => createAttempt({ ...required, at: undefined })).toThrow(/canonical ISO-8601 timestamp/);
    expect(() => createAttempt({ ...required, at: 'yesterday' })).toThrow(/canonical ISO-8601 timestamp/);
  });
});
