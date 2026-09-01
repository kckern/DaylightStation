import { describe, expect, it } from 'vitest';
import { createAttempt, effectiveAttempts, isAttemptInvalidation } from './attempt.mjs';

const required = {
  id: 'att_fixed',
  at: '2026-08-01T15:00:00.000Z',
  sessionId: 'session-1',
  bankId: 'bank-1',
  itemId: 'item-1',
  itemType: 'multiple_choice',
  mode: 'quiz',
  given: 'B',
  correct: true,
  attributedTo: 'user_4',
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

describe('attempt invalidation tombstones', () => {
  const original = { id: 'att_bad', sessionId: 'ses_bad', correct: false };
  const tombstone = {
    ...original,
    id: 'att_inv_bad',
    provenance: {
      kind: 'invalidation', of: 'att_bad', invalidationId: 'inv_1',
      by: 'parent', reason: 'wrong answer sheet', invalidatedAt: '2026-08-31T18:00:00.000Z',
    },
  };

  it('keeps the raw ledger append-only while removing both rows from effective history', () => {
    const ledger = [original, { id: 'att_good', correct: true }, tombstone];
    expect(ledger).toHaveLength(3);
    expect(effectiveAttempts(ledger)).toEqual([{ id: 'att_good', correct: true }]);
  });

  it('does not treat unrelated provenance as an invalidation', () => {
    expect(isAttemptInvalidation({ provenance: { kind: 'invalidation' } })).toBe(false);
    expect(effectiveAttempts([{ id: 'att_1', provenance: { kind: 'regrade', of: 'att_0' } }]))
      .toHaveLength(1);
  });
});
