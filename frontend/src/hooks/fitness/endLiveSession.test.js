import { describe, it, expect } from 'vitest';
import { endLiveSession } from './endLiveSession.js';

describe('endLiveSession', () => {
  it('returns false and is a no-op when there is no session', () => {
    expect(endLiveSession(null)).toBe(false);
    expect(endLiveSession({ sessionId: null })).toBe(false);
  });

  it('ends an active session with reason "user_initiated" and returns true', () => {
    const calls = [];
    const fake = {
      sessionId: 'fs_123',
      endSession(reason) { calls.push(reason); this.sessionId = null; return true; }
    };
    const result = endLiveSession(fake);
    expect(result).toBe(true);
    expect(calls).toEqual(['user_initiated']);
    expect(fake.sessionId).toBeNull();
  });
});
