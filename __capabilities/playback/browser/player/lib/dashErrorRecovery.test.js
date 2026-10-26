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

describe('requestDashErrorRecovery shared safety gate', () => {
  const SESSION = 'owner:visit';
  it('refreshes once, rejects overlaps, and retains the shared cap across remounts', () => {
    let now = 1000000;
    const ledger = createRecoveryLedger({ now: () => now });
    for (let i = 0; i < 3; i++) {
      const result = requestDashErrorRecovery({ errorCode: 27, sessionKey: SESSION, mountId: `mount-${i}`, ledger });
      expect(result.fire).toBe(true);
      expect(result.gate.attempt).toBe(i + 1);
      expect(requestDashErrorRecovery({ errorCode: 28, sessionKey: SESSION, mountId: 'other', ledger }))
        .toMatchObject({ fire: false, gate: { deniedBy: i < 2 ? 'in-flight' : 'session-cap' } });
      ledger.completeAction({ sessionKey: SESSION, actionId: result.gate.actionId });
      now += 4000;
    }
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 3, rollingCount: 3, urlRefreshCount: 3 });
    expect(requestDashErrorRecovery({ errorCode: 28, sessionKey: SESSION, mountId: 'new-mount', ledger }))
      .toMatchObject({ fire: false, gate: { deniedBy: 'session-cap' } });
    expect(ledger.request({ sessionKey: SESSION, actor: 'resilience', reason: 'stall' }))
      .toMatchObject({ allowed: false, deniedBy: 'session-cap' });
  });
  it('does not spend budget for an unrelated code', () => {
    const ledger = createRecoveryLedger();
    expect(requestDashErrorRecovery({ errorCode: 25, sessionKey: SESSION, ledger }).fire).toBe(false);
    expect(ledger.snapshot(SESSION)).toBeNull();
  });
  it('uses a bounded shared bucket for hosts without identity', () => {
    let now = 1000000;
    const ledger = createRecoveryLedger({ now: () => now });
    for (let i = 0; i < 3; i++) {
      const result = requestDashErrorRecovery({ errorCode: 27, sessionKey: null, mountId: `mount-${i}`, ledger });
      expect(result.fire).toBe(true);
      ledger.completeAction({ sessionKey: 'player-item:unkeyed', actionId: result.gate.actionId });
      now += 4000;
    }
    expect(requestDashErrorRecovery({ errorCode: 28, sessionKey: null, mountId: 'new', ledger }))
      .toMatchObject({ fire: false, gate: { deniedBy: 'session-cap' } });
  });
});
