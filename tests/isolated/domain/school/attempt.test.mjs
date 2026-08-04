import { describe, it, expect } from 'vitest';
import { createAttempt } from '#domains/school/attempt.mjs';

describe('createAttempt', () => {
  const base = { at: '2026-08-01T15:00:00.000Z', sessionId: 'ses_x', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'Olympia', correct: true, attributedTo: 'kckern' };
  it('stamps an id, retains the application time, and passes fields through', () => {
    const a = createAttempt(base);
    expect(a.id).toMatch(/^att_/);
    expect(new Date(a.at).toISOString()).toBe(a.at);
    expect(a).toMatchObject(base);
  });
  it('generates unique ids', () => {
    expect(createAttempt(base).id).not.toBe(createAttempt(base).id);
  });
});
