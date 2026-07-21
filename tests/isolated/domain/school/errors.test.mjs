import { describe, it, expect } from 'vitest';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';

// finding 3: bare `class X extends Error {}` leaves error.name === 'Error' (JS
// does not set it for subclasses) and has nowhere to attach the bank/session
// context a caller needs to log. These follow the same idiom as
// backend/src/2_domains/core/errors/{ValidationError,EntityNotFoundError}.mjs.
describe('GuestForbiddenError', () => {
  it('sets its own name and carries the bankId that triggered it', () => {
    const error = new GuestForbiddenError('Guest cannot access this bank', { bankId: 'wa-history-1' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GuestForbiddenError');
    expect(error.message).toBe('Guest cannot access this bank');
    expect(error.bankId).toBe('wa-history-1');
  });
});

describe('SessionGoneError', () => {
  it('sets its own name and carries the sessionId that triggered it', () => {
    const error = new SessionGoneError('Session no longer exists', { sessionId: 'sess-42' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SessionGoneError');
    expect(error.message).toBe('Session no longer exists');
    expect(error.sessionId).toBe('sess-42');
  });
});
