import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRecoveryLedger,
  RECOVERY_MAX_ATTEMPTS,
  getSessionsCreatedAllLedgers,
  _resetSessionsCreatedForTests
} from './recoveryLedger.js';

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

// ---------------------------------------------------------------------------
// Production DEFAULTS pin — every test above configures the ledger explicitly,
// so nothing else would catch silent drift in the shipped defaults. Probed
// behaviorally (DEFAULTS is intentionally not exported).
// ---------------------------------------------------------------------------

describe('recoveryLedger production DEFAULTS', () => {
  it('RECOVERY_MAX_ATTEMPTS is 5 and is the default session cap', () => {
    expect(RECOVERY_MAX_ATTEMPTS).toBe(5);
    let now = 1_000_000;
    const ledger = createRecoveryLedger({ now: () => now });
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS; i++) {
      expect(ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x', bypassCooldown: true }).allowed).toBe(true);
    }
    expect(ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x', bypassCooldown: true }))
      .toMatchObject({ allowed: false, deniedBy: 'session-cap' });
  });

  it('default cooldown is 4000ms with ×3 backoff (4s after attempt 1, 12s after attempt 2)', () => {
    let now = 1_000_000;
    const ledger = createRecoveryLedger({ now: () => now });
    ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' }); // attempt 1
    now += 3999;
    expect(ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' }))
      .toMatchObject({ allowed: false, deniedBy: 'cooldown', waitMs: 1 });
    now += 1;
    expect(ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' }).allowed).toBe(true); // attempt 2
    now += 11999;
    expect(ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' }))
      .toMatchObject({ allowed: false, deniedBy: 'cooldown', waitMs: 1 });
  });

  it("default per-mount budget for 'dash-error' is 3", () => {
    let now = 1_000_000;
    const ledger = createRecoveryLedger({ now: () => now });
    for (let i = 0; i < 3; i++) {
      expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }).allowed).toBe(true);
    }
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }))
      .toMatchObject({ allowed: false, deniedBy: 'mount-budget' });
  });
});

// ---------------------------------------------------------------------------
// Auditability (2026-08-16). The three teardown paths used to erase state in
// full silence, so `resilience-recovery attempt=1` repeating forever could mean
// either "the cap keeps resetting" or "the cap was never reached". These tests
// pin the difference.
// ---------------------------------------------------------------------------

describe('recoveryLedger teardown reporting', () => {
  let now, emitted, ledger;

  const makeLogger = () => ({
    sampled: (event, data, opts) => { emitted.push({ event, data, opts }); },
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {}
  });

  beforeEach(() => {
    now = 1_000_000;
    emitted = [];
    _resetSessionsCreatedForTests();
    ledger = createRecoveryLedger({ now: () => now, logger: makeLogger() });
  });

  const releases = () => emitted.filter((e) => e.event === 'recovery-ledger.session-released');

  it('releaseSession reports what it is about to destroy, before destroying it', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'x', isUrlRefresh: true });
    now += 2500;
    ledger.releaseSession(SESSION);

    expect(releases()).toHaveLength(1);
    expect(releases()[0].data).toMatchObject({
      sessionKey: SESSION,
      releasedBy: 'release',
      count: 1,
      urlRefreshCount: 1,
      exhausted: false,
      mountCount: 1,
      ageMs: 2500,
      sessionsCreated: 1
    });
    expect(ledger.snapshot(SESSION)).toBeNull();
  });

  it('userReset reports under its own releasedBy, carrying the exhausted state it clears', () => {
    for (let i = 0; i < 5; i++) ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x', bypassCooldown: true });
    ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x', bypassCooldown: true }); // trips `exhausted`
    ledger.userReset(SESSION);

    expect(releases()).toHaveLength(1);
    expect(releases()[0].data).toMatchObject({ releasedBy: 'user-reset', count: 5, exhausted: true });
  });

  it('recordSuccess reports the attempt record it erases', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'x' });
    now += 700;
    ledger.recordSuccess(SESSION);

    expect(releases()).toHaveLength(1);
    expect(releases()[0].data).toMatchObject({ releasedBy: 'success', count: 1, mountCount: 1, ageMs: 700 });
  });

  it('recordSuccess on an already-clean session reports nothing (it is called on every progress tick)', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    ledger.recordSuccess(SESSION);
    emitted.length = 0;

    ledger.recordSuccess(SESSION);
    ledger.recordSuccess(SESSION);
    expect(releases()).toHaveLength(0);
  });

  it('releasing a key that was never minted reports nothing — there was nothing to destroy', () => {
    ledger.releaseSession('player-item:never-seen');
    ledger.userReset('player-item:never-seen');
    expect(releases()).toHaveLength(0);
  });

  it('rate-limits the teardown event, because identity churn is what fires it', () => {
    ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' });
    ledger.releaseSession(SESSION);
    expect(releases()[0].opts).toMatchObject({ aggregate: true });
    expect(releases()[0].opts.maxPerMinute).toBeGreaterThan(0);
  });

  it('sessionsCreated survives release — it is the transcode-session count', () => {
    // The incident in miniature: identity churns, so each generation mints a
    // session and the release erases it. snapshot() shows one fresh session with
    // count=1 every time; only sessionsCreated shows that 6 of them happened.
    for (let i = 0; i < 6; i++) {
      const key = `player-item:guid-${i}`;
      ledger.request({ sessionKey: key, actor: 'a', reason: 'x' });
      expect(ledger.snapshot(key).count).toBe(1);
      ledger.releaseSession(key);
    }

    expect(ledger.dumpAll()).toMatchObject({ sessionsCreated: 6, sessionsLive: 0 });
    expect(getSessionsCreatedAllLedgers()).toBe(6);
    // And the last teardown carried the running mint count with it.
    expect(releases()[5].data.sessionsCreated).toBe(6);
  });

  it('a stable session that retries does NOT inflate sessionsCreated', () => {
    // The counter measures minted sessions, not attempts — otherwise it could
    // not separate "the cap keeps resetting" from "the cap was never reached".
    for (let i = 0; i < 4; i++) ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x', bypassCooldown: true });
    expect(ledger.dumpAll()).toMatchObject({ sessionsCreated: 1, sessionsLive: 1 });
    expect(ledger.snapshot(SESSION).count).toBe(4);
  });

  it('dumpAll exposes the live state including mounts, without the caller knowing a key', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'x', bypassCooldown: true });
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'x', bypassCooldown: true });
    ledger.request({ sessionKey: 'player-item:other', mountId: 'm2', actor: 'dash-error', reason: 'x', bypassCooldown: true });
    now += 1200;

    const dump = ledger.dumpAll();
    expect(dump).toMatchObject({ sessionsCreated: 2, sessionsLive: 2, atMs: now });
    const first = dump.sessions.find((s) => s.sessionKey === SESSION);
    expect(first).toMatchObject({ count: 2, urlRefreshCount: 0, exhausted: false, ageMs: 1200 });
    expect(first.mounts).toEqual([{ mountId: 'm1', actors: { 'dash-error': 2 } }]);
    expect(dump.sessions.find((s) => s.sessionKey === 'player-item:other').mounts)
      .toEqual([{ mountId: 'm2', actors: { 'dash-error': 1 } }]);
  });

  it('dumpAll returns copies, so a caller cannot mutate the ledger through it', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'x' });
    const dump = ledger.dumpAll();
    dump.sessions[0].count = 99;
    dump.sessions[0].mounts.length = 0;

    expect(ledger.snapshot(SESSION).count).toBe(1);
    expect(ledger.dumpAll().sessions[0].mounts).toEqual([{ mountId: 'm1', actors: { 'dash-error': 1 } }]);
  });

  it('the tab-wide mint counter spans ledgers and never decreases', () => {
    ledger.request({ sessionKey: SESSION, actor: 'a', reason: 'x' });
    const other = createRecoveryLedger({ now: () => now, logger: makeLogger() });
    other.request({ sessionKey: 'player-item:elsewhere', actor: 'a', reason: 'x' });

    expect(getSessionsCreatedAllLedgers()).toBe(2);
    ledger.releaseSession(SESSION);
    other.releaseSession('player-item:elsewhere');
    expect(getSessionsCreatedAllLedgers()).toBe(2);
    expect(ledger.dumpAll().sessionsCreated).toBe(1);
    expect(other.dumpAll().sessionsCreated).toBe(1);
  });

  it('reporting cannot break the accounting when the logger throws', () => {
    const hostile = createRecoveryLedger({
      now: () => now,
      logger: { sampled: () => { throw new Error('transport down'); }, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    });
    hostile.request({ sessionKey: SESSION, actor: 'a', reason: 'x' });
    expect(() => hostile.releaseSession(SESSION)).not.toThrow();
    expect(hostile.snapshot(SESSION)).toBeNull();
  });
});
