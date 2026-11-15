import { describe, it, expect, beforeEach } from 'vitest';
import { createRecoveryLedger, getSessionsCreatedAllLedgers, _resetSessionsCreatedForTests } from './recoveryLedger.js';

const SESSION = 'owner:visit';
describe('shared recovery accounting', () => {
  let now, ledger, sequence, events;
  beforeEach(() => {
    now = 1000000;
    sequence = 0;
    events = [];
    _resetSessionsCreatedForTests();
    ledger = createRecoveryLedger({ now: () => now, logger: { sampled: (...args) => events.push(args) } });
  });
  const reserve = (extra = {}) => ledger.reserveAction({ sessionKey: SESSION, mountId: 'decoder-a', actor: 'resilience', reason: 'stall', actionId: `action-${++sequence}`, ...extra });
  const finish = (gate) => ledger.completeAction({ sessionKey: SESSION, actionId: gate.actionId });
  const next = () => { now += 4000; };
  const healthyFor = (ms) => {
    ledger.observeHealth({ sessionKey: SESSION, healthy: true, eligible: true, atMs: now });
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      now += 500;
      ledger.observeHealth({ sessionKey: SESSION, healthy: true, eligible: true, atMs: now });
    }
  };
  it('debits each ID once and allows only one in-flight action until matching completion', () => {
    const first = reserve();
    expect(first).toMatchObject({ allowed: true, attempt: 1 });
    next();
    expect(reserve()).toMatchObject({ allowed: false, deniedBy: 'in-flight' });
    expect(reserve({ actionId: first.actionId })).toMatchObject({ allowed: true, duplicate: true, attempt: 1 });
    ledger.completeAction({ sessionKey: SESSION, actionId: 'stale-action' });
    expect(ledger.snapshot(SESSION).inFlightActionId).toBe(first.actionId);
    finish(first);
    expect(reserve()).toMatchObject({ allowed: true, attempt: 2 });
    expect(ledger.snapshot(SESSION).rollingCount).toBe(2);
  });
  it('never resets after ten play-three-seconds/stall-two-seconds cycles or a decoder remount', () => {
    finish(reserve());
    for (let cycle = 0; cycle < 10; cycle++) {
      healthyFor(3000);
      ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: true, atMs: now });
      now += 2000;
    }
    expect(ledger.snapshot(SESSION).count).toBe(1);
    expect(reserve({ mountId: 'replacement' })).toMatchObject({ allowed: true, attempt: 2 });
  });
  it('requires 60 continuous healthy seconds and retains rolling history and last-action spacing', () => {
    finish(reserve());
    healthyFor(59000);
    expect(ledger.snapshot(SESSION).count).toBe(1);
    healthyFor(1000);
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 0, rollingCount: 1 });
    expect(reserve()).toMatchObject({ allowed: true, attempt: 1 });
  });
  it('pause and unknown gaps break continuous healthy credit', () => {
    finish(reserve());
    healthyFor(59000);
    ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: false, atMs: now });
    now += 60000;
    healthyFor(1000);
    expect(ledger.snapshot(SESSION).count).toBe(1);
    now += 10000; // missing samples cannot earn success either
    healthyFor(59000);
    expect(ledger.snapshot(SESSION).count).toBe(1);
  });
  it('enforces three incident actions across actors and remounts and six across Retry incidents', () => {
    for (let incident = 0; incident < 2; incident++) {
      for (let i = 0; i < 3; i++) {
        const gate = reserve({ actor: `actor-${i}`, mountId: `mount-${i}` });
        expect(gate.allowed).toBe(true);
        finish(gate);
        next();
      }
      expect(reserve()).toMatchObject({ allowed: false, exhausted: true, deniedBy: 'session-cap' });
      ledger.userReset(SESSION);
    }
    expect(reserve()).toMatchObject({ allowed: false, exhausted: true, deniedBy: 'rolling-cap' });
    expect(ledger.snapshot(SESSION).retryAfterMs).toBeGreaterThan(0);
    now += 600000;
    expect(reserve().allowed).toBe(true);
  });
  it('does not let bypassCooldown override four-second minimum spacing', () => {
    finish(reserve());
    now += 3999;
    expect(reserve({ bypassCooldown: true })).toMatchObject({ allowed: false, deniedBy: 'cooldown', waitMs: 1 });
    now++;
    expect(reserve({ bypassCooldown: true }).allowed).toBe(true);
  });
  it('holds a reservation until 15 eligible seconds, freezing its deadline during pause', () => {
    reserve();
    ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: true, atMs: now });
    for (let i = 0; i < 28; i++) { now += 500; ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: true, atMs: now }); }
    ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: false, atMs: now });
    now += 60000;
    ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: true, atMs: now });
    expect(ledger.snapshot(SESSION).inFlightActionId).not.toBeNull();
    for (let i = 0; i < 2; i++) { now += 500; ledger.observeHealth({ sessionKey: SESSION, healthy: false, eligible: true, atMs: now }); }
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 1, inFlightActionId: null });
  });
  it('retains stricter per-mount limits across success and Retry', () => {
    ledger = createRecoveryLedger({ now: () => now, mountBudgets: { 'dash-error': 1 } });
    finish(reserve({ actor: 'dash-error' })); next();
    ledger.userReset(SESSION);
    expect(reserve({ actor: 'dash-error' })).toMatchObject({ allowed: false, deniedBy: 'mount-budget' });
    expect(reserve({ actor: 'dash-error', mountId: 'new-renderer' }).allowed).toBe(true);
  });
  it('separates two owners and duplicate visits, releasing only an actually ended visit', () => {
    reserve();
    expect(reserve({ sessionKey: 'other-owner:visit' }).allowed).toBe(true);
    expect(reserve({ sessionKey: 'owner:repeat-visit' }).allowed).toBe(true);
    ledger.releaseSession('owner:repeat-visit');
    expect(ledger.snapshot(SESSION).count).toBe(1);
    expect(ledger.dumpAll()).toMatchObject({ sessionsCreated: 3, sessionsLive: 2 });
    expect(getSessionsCreatedAllLedgers()).toBe(3);
    const dump = ledger.dumpAll(); dump.sessions[0].count = 999;
    expect(ledger.snapshot(SESSION).count).toBe(1);
  });
  it('legacy requests get unique IDs and retain refresh telemetry', () => {
    const a = ledger.request({ sessionKey: SESSION, actor: 'dash-error', isUrlRefresh: true });
    finish(a); next();
    const b = ledger.request({ sessionKey: SESSION, actor: 'jolt' });
    expect(b.actionId).not.toBe(a.actionId);
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 2, urlRefreshCount: 1, inFlightActionId: b.actionId });
  });
  it('never debits an already completed action ID again after the rolling window expires', () => {
    const first = reserve({ actionId: 'once-only' }); finish(first);
    now += 600001;
    ledger.userReset(SESSION);
    expect(reserve({ actionId: 'once-only' })).toMatchObject({ allowed: true, duplicate: true });
    expect(ledger.snapshot(SESSION)).toMatchObject({ count: 0, rollingCount: 0, inFlightActionId: null });
  });
  it('reporting failure cannot break accounting or release', () => {
    ledger = createRecoveryLedger({ now: () => now, logger: { sampled: () => { throw new Error('offline logger'); } } });
    reserve();
    expect(() => ledger.releaseSession(SESSION)).not.toThrow();
    expect(ledger.snapshot(SESSION)).toBeNull();
  });
});
