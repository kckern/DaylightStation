import { describe, it, expect } from 'vitest';
import { createAttempt } from '#domains/school/attempt.mjs';

describe('createAttempt', () => {
  const base = { id: 'att_fixed', at: '2026-08-01T15:00:00.000Z', sessionId: 'ses_x', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'Olympia', correct: true, attributedTo: 'kckern' };
  it('retains the supplied id and application time, and passes fields through', () => {
    const a = createAttempt(base);
    expect(a.id).toBe('att_fixed');
    expect(new Date(a.at).toISOString()).toBe(a.at);
    expect(a).toMatchObject(base);
  });
  it('requires an id', () => {
    expect(() => createAttempt({ ...base, id: undefined })).toThrow(/id is required/);
  });
});
