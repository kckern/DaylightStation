import { describe, it, expect } from 'vitest';
import { decideDashErrorRecovery } from './dashErrorRecovery.js';

describe('decideDashErrorRecovery', () => {
  it('returns refresh-url for error 27 (segment unavailable) on first attempt', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/segment/i);
  });

  it('returns refresh-url for error 28 (init segment / manifest unavailable)', () => {
    const r = decideDashErrorRecovery({ errorCode: 28, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/init|manifest|header/i);
  });

  it('returns refresh-url at attempt = maxAttempts - 1 (still within budget)', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 2, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
  });

  it('returns ignore at attempt >= maxAttempts (budget exhausted)', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 3, maxAttempts: 3 });
    expect(r.action).toBe('ignore');
    expect(r.reason).toMatch(/budget|exhaust|max/i);
  });

  it('returns ignore for unrelated dash error codes (decode, network mid-stream)', () => {
    const r = decideDashErrorRecovery({ errorCode: 25, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('ignore');
    const r2 = decideDashErrorRecovery({ errorCode: 1001, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r2.action).toBe('ignore');
    const r3 = decideDashErrorRecovery({ errorCode: null, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r3.action).toBe('ignore');
  });

  it('default maxAttempts is 3 when omitted', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 3 });
    expect(r.action).toBe('ignore');
  });
});
