import { describe, it, expect } from 'vitest';
import { createAttempt } from '#domains/school/attempt.mjs';

describe('createAttempt', () => {
  const base = { sessionId: 'ses_x', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'Olympia', correct: true, attributedTo: 'kckern' };
  it('stamps id and ISO timestamp and passes fields through', () => {
    const a = createAttempt(base);
    expect(a.id).toMatch(/^att_/);
    expect(new Date(a.at).toISOString()).toBe(a.at);
    expect(a).toMatchObject(base);
  });
  it('generates unique ids', () => {
    expect(createAttempt(base).id).not.toBe(createAttempt(base).id);
  });
});
