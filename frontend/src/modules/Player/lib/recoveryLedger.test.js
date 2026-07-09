import { describe, it, expect, beforeEach } from 'vitest';
import { createRecoveryLedger } from './recoveryLedger.js';

const SESSION = 'player-item:abc';

describe('recoveryLedger', () => {
  let now, ledger;
  beforeEach(() => {
    now = 1_000_000;
    ledger = createRecoveryLedger({
      maxAttempts: 5,
      cooldownMs: 4000,
      cooldownBackoffMultiplier: 3,
      mountBudgets: { 'dash-error': 3 },
      now: () => now
    });
  });

  it('allows the first request and records the attempt', () => {
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'startup-deadline-exceeded' });
    expect(r).toMatchObject({ allowed: true, attempt: 1, exhausted: false });
  });

  it('denies inside the cooldown window, allows after it', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' });
    now += 1000;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' }).allowed).toBe(false);
    now += 4000; // past 4s cooldown for attempt 1
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' }).allowed).toBe(true);
  });

  it('backs off exponentially: 4s, 12s, 36s', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }); // attempt 1
    now += 4001;
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }); // attempt 2
    now += 4001;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(false); // needs 12s now
    now += 8000;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(true);
  });

  it('exhausts at the session cap regardless of actor', () => {
    for (let i = 0; i < 5; i++) {
      const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: `actor-${i}`, reason: 'x', bypassCooldown: true });
      expect(r.allowed).toBe(true);
    }
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'late', reason: 'x', bypassCooldown: true });
    expect(r).toMatchObject({ allowed: false, exhausted: true });
  });

  it('enforces per-mount sub-budget for a configured actor without consuming the session cap prematurely', () => {
    for (let i = 0; i < 3; i++) {
      expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }).allowed).toBe(true);
    }
    // 4th dash-error on the SAME mount: denied by sub-budget (not session exhaustion)
    const denied = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true });
    expect(denied).toMatchObject({ allowed: false, exhausted: false });
    // New mount = fresh sub-budget (session cap still applies: 3 used + this = 4 of 5)
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm2', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }).allowed).toBe(true);
  });

  it('recordSuccess clears attempts and cooldown for the session', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    ledger.recordSuccess(SESSION);
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    expect(r).toMatchObject({ allowed: true, attempt: 1 });
  });

  it('userReset clears everything including exhaustion (retry-from-exhausted)', () => {
    for (let i = 0; i < 5; i++) ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', bypassCooldown: true });
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', bypassCooldown: true }).exhausted).toBe(true);
    ledger.userReset(SESSION);
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(true);
  });

  it('releaseSession prunes state (no unbounded growth)', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    ledger.releaseSession(SESSION);
    expect(ledger.snapshot(SESSION)).toBeNull();
  });

  it('urlRefresh counting survives for telemetry', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', isUrlRefresh: true });
    expect(ledger.snapshot(SESSION).urlRefreshCount).toBe(1);
  });

  it('cooldown denial reports waitMs = effectiveCooldown - elapsed (rung reschedule input)', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    now += 1000;
    const denied = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    expect(denied).toMatchObject({ allowed: false, deniedBy: 'cooldown', waitMs: 3000 }); // 4000 cooldown - 1000 elapsed
  });

  it('bypassCooldown still records count and lastAt (cross-actor cooldown push is deliberate)', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', bypassCooldown: true });
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 1, lastAt: now });
    // A non-bypass actor immediately after is inside the cooldown the bypassed attempt started
    const denied = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'b', reason: 'x' });
    expect(denied).toMatchObject({ allowed: false, deniedBy: 'cooldown' });
  });

  it('recordSuccess preserves urlRefreshCount telemetry while clearing attempt state', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', isUrlRefresh: true });
    ledger.recordSuccess(SESSION);
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 0, lastAt: 0, exhausted: false, urlRefreshCount: 1 });
  });

  it('a budgeted actor WITHOUT a mountId is not budget-limited (documented footgun)', () => {
    for (let i = 0; i < 4; i++) {
      const r = ledger.request({ sessionKey: SESSION, actor: 'dash-error', reason: 'dash-28', bypassCooldown: true });
      expect(r.allowed).toBe(true); // 4th exceeds the per-mount budget of 3, but no mountId = no budget gate
    }
  });
});
