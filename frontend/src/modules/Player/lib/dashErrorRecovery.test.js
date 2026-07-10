import { describe, it, expect } from 'vitest';
import { decideDashErrorRecovery, requestDashErrorRecovery } from './dashErrorRecovery.js';
import { createRecoveryLedger } from './recoveryLedger.js';

describe('decideDashErrorRecovery (classification)', () => {
  it('classifies error 27 (segment unavailable) as refresh-url', () => {
    const r = decideDashErrorRecovery({ errorCode: 27 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/segment/i);
  });

  it('classifies error 28 (init segment / manifest unavailable) as refresh-url', () => {
    const r = decideDashErrorRecovery({ errorCode: 28 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/init|manifest|header/i);
  });

  it('classifies unrelated dash error codes as ignore (decode, network mid-stream)', () => {
    for (const errorCode of [25, 1001, 0, null, undefined, '27']) {
      const r = decideDashErrorRecovery({ errorCode });
      expect(r.action).toBe('ignore');
      expect(r.reason).toBe('not-a-source-url-error');
    }
  });
});

describe('requestDashErrorRecovery (ledger-gated)', () => {
  const SESSION = 'player-item:test-guid';

  const makeLedger = () => createRecoveryLedger({
    maxAttempts: 5,
    cooldownMs: 4000,
    mountBudgets: { 'dash-error': 3 },
    now: () => 1_000_000 // frozen clock: proves bypassCooldown, not elapsed time
  });

  it('fires for a refreshable code and records the attempt as a URL refresh', () => {
    const ledger = makeLedger();
    const r = requestDashErrorRecovery({ errorCode: 28, sessionKey: SESSION, mountId: 'm1', ledger });
    expect(r.fire).toBe(true);
    expect(r.gate.attempt).toBe(1);
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 1, urlRefreshCount: 1 });
  });

  it('never touches the ledger for a non-refreshable code', () => {
    const ledger = makeLedger();
    const r = requestDashErrorRecovery({ errorCode: 25, sessionKey: SESSION, mountId: 'm1', ledger });
    expect(r.fire).toBe(false);
    expect(r.gate).toBeNull();
    expect(ledger.snapshot(SESSION)).toBeNull();
  });

  it('denies the 4th dash error on one mount (mount budget of 3), even back-to-back', () => {
    const ledger = makeLedger();
    for (let i = 0; i < 3; i++) {
      // Frozen clock: allowed despite zero elapsed time — bypassCooldown wiring.
      expect(requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm1', ledger }).fire).toBe(true);
    }
    const fourth = requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm1', ledger });
    expect(fourth.fire).toBe(false);
    expect(fourth.gate.deniedBy).toBe('mount-budget');
    expect(fourth.gate.exhausted).toBe(false); // budget denial, NOT session exhaustion
    expect(ledger.snapshot(SESSION).count).toBe(3); // denied request not recorded
  });

  it('grants a fresh mount budget after remount, but the session cap still binds', () => {
    const ledger = makeLedger();
    for (let i = 0; i < 3; i++) {
      requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm1', ledger });
    }
    // New mount → fresh 3-attempt allotment, but session cap (5) leaves only 2.
    expect(requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm2', ledger }).fire).toBe(true);
    expect(requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm2', ledger }).fire).toBe(true);
    const sixth = requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: 'm2', ledger });
    expect(sixth.fire).toBe(false);
    expect(sixth.gate.deniedBy).toBe('session-cap');
  });

  it('dash-error attempts consume the same session cap other actors see (audit §3.1)', () => {
    const ledger = makeLedger();
    for (let i = 0; i < 3; i++) {
      requestDashErrorRecovery({ errorCode: 28, sessionKey: SESSION, mountId: 'm1', ledger });
    }
    // The resilience actor now has only 2 of the 5 session attempts left.
    ledger.request({ sessionKey: SESSION, actor: 'resilience', reason: 'x', bypassCooldown: true });
    ledger.request({ sessionKey: SESSION, actor: 'resilience', reason: 'x', bypassCooldown: true });
    const capped = ledger.request({ sessionKey: SESSION, actor: 'resilience', reason: 'x', bypassCooldown: true });
    expect(capped.allowed).toBe(false);
    expect(capped.deniedBy).toBe('session-cap');
  });
});
