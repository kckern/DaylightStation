import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';

// ---------------------------------------------------------------------------
// useMediaResilience × recoveryLedger — the hook's recovery accounting now
// lives in the shared ledger (audit §3.2 / §8 Phase 1). These tests pin the
// two deliberate behavior changes:
//   1. jolt rungs now respect the cooldown (previously _recordRecovery only
//      counted attempts; the ladder fired on its own STEP_MS schedule).
//   2. exhaustion notification is deduped consumer-side (the ledger returns
//      exhausted:true on EVERY capped request).
// ---------------------------------------------------------------------------

// Injectable ledger clock, independent of vitest's Date faking. Starts >0 so
// the ledger's lastAt=0 "never attempted" sentinel can't collide with t=0.
let fakeNow;
let ledger;

const installLedger = (opts = {}) => {
  fakeNow = 1_000_000;
  ledger = createRecoveryLedger({ now: () => fakeNow, ...opts });
  _setSharedLedgerForTests(ledger);
  return ledger;
};

// Advance both the hook's timers (setTimeout rungs) and the ledger clock.
const advance = (ms) => {
  fakeNow += ms;
  act(() => { vi.advanceTimersByTime(ms); });
};

const baseArgs = (overrides = {}) => ({
  onReload: vi.fn(),
  onExhausted: vi.fn(),
  // NOTE: meta deliberately lacks mediaType/plex/contentId keys so
  // shouldArmStartupDeadline stays false — no phantom deadline recoveries
  // firing mid-test when we advance fake timers.
  meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
  waitKey: 'test:ledger',
  playbackSessionKey: 'session-ledger-test',
  disabled: false,
  getMediaEl: () => null,
  seconds: 0,
  // No configOverrides: attempt cap + cooldown are ledger-owned
  // (RECOVERY_MAX_ATTEMPTS et al.), not configurable through the hook.
  ...overrides
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  _setSharedLedgerForTests(null);
});

// ---------------------------------------------------------------------------
// (a) triggerRecovery is cooldown-gated by the ledger
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — triggerRecovery cooldown gating', () => {
  it('denies a recovery inside the cooldown window (no onReload), allows after it elapses', () => {
    installLedger(); // defaults: cooldownMs 4000, backoff ×3
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));

    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(1);

    // Immediately again: inside the 4s post-attempt-1 cooldown → denied.
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);

    // Past the cooldown → allowed.
    fakeNow += 4001;
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(2);
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (b) jolt rungs consume ledger attempts AND respect the cooldown
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — jolt ladder respects the cooldown (audit §3.2)', () => {
  // Drives the hook into the isStuck state: progress first (sets
  // hasEverPlayedRef), then a waitKey change (resets progressToken so the
  // progress effect stops clearing the ledger), then externalStalled.
  const renderStuckHook = () => {
    const initial = baseArgs({ waitKey: 'wk-1', externalStalled: false });
    const hook = renderHook((props) => useMediaResilience(props), { initialProps: initial });
    // Progress: seconds jump ≥ epsilon → progressToken bumps → hasEverPlayed.
    act(() => { hook.rerender({ ...initial, seconds: 5 }); });
    // New waitKey resets playback-health progress, then freeze + stall.
    act(() => { hook.rerender({ ...initial, seconds: 5, waitKey: 'wk-2', externalStalled: true }); });
    return { hook, args: initial };
  };

  it('cooldown-denied rung does NOT fire onReload, reschedules at waitMs, then fires', () => {
    // cooldown 10s > STALL_JOLT_STEP_MS (6s) so rung 2 lands inside the window.
    installLedger({ cooldownMs: 10000 });
    const { args } = renderStuckHook();
    args.onReload.mockClear();

    // Grace (4500ms) → rung 1 fires, attempt 1 recorded.
    advance(4500);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'stall-jolt-refresh-url' }));
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);

    // STEP_MS later: only 6s of the 10s cooldown elapsed → rung 2 must be
    // denied (previously it fired unconditionally — the §3.2 bug).
    advance(6000);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);

    // Denied rung rescheduled at waitMs (10000 - 6000 = 4000); after it the
    // SAME rung fires (step was not advanced past the remount rung).
    advance(4001);
    expect(args.onReload).toHaveBeenCalledTimes(2);
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'stall-jolt-remount' }));
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(2);
    expect(args.onExhausted).not.toHaveBeenCalled();
  });

  it('ladder exhaustion fires onExhausted once with the ledger attempt count', () => {
    installLedger({ cooldownMs: 0 }); // no cooldown — pure ladder pacing
    const { args } = renderStuckHook();
    args.onReload.mockClear();

    advance(4500); // rung 1
    advance(6000); // rung 2
    expect(args.onReload).toHaveBeenCalledTimes(2);
    advance(6000); // past the last rung → exhausted
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stall-jolt-exhausted',
      attempts: 2
    }));
  });
});

// ---------------------------------------------------------------------------
// (c) exhaustion notification is deduped consumer-side
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — exhaustion dedupe', () => {
  it('fires onExhausted exactly once with the ledger attempt count, even on repeated capped requests', () => {
    installLedger({ cooldownMs: 0 }); // isolate the session cap
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));

    act(() => {
      for (let i = 0; i < 5; i += 1) result.current._testTriggerRecovery?.('playback-stalled');
    });
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).not.toHaveBeenCalled();

    // The ledger returns exhausted:true on EVERY capped request — the hook
    // must notify only once.
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ attempts: 5 }));
  });
});

// ---------------------------------------------------------------------------
// (d) retryFromExhausted → ledger.userReset → attempts start over at 1
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — retryFromExhausted resets the ledger', () => {
  it('userReset clears the session so the next triggerRecovery is attempt 1, and a second exhaustion can notify again', () => {
    installLedger({ cooldownMs: 0 });
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));

    // Exhaust.
    act(() => {
      for (let i = 0; i < 6; i += 1) result.current._testTriggerRecovery?.('playback-stalled');
    });
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);

    // User retry: not ledger-gated, resets the session.
    act(() => result.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'user-retry-exhausted' }));
    expect(ledger.snapshot(args.playbackSessionKey)).toBeNull();

    // Next recovery is attempt 1 again.
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'playback-stalled' }));
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);

    // A fresh exhaustion round must be able to notify again (dedupe resets).
    act(() => {
      for (let i = 0; i < 5; i += 1) result.current._testTriggerRecovery?.('playback-stalled');
    });
    expect(args.onExhausted).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// (e) controllerRef.forceReload routes through gated recovery (audit §3.2 —
//     the fifth ledger bypass: Fitness callers used to hit raw onReload)
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — controllerRef.forceReload is gated', () => {
  it('fires inside another actor\'s cooldown window (bypass) AND records — pushing the shared cooldown forward', () => {
    installLedger(); // defaults: cooldownMs 4000, backoff ×3
    const controllerRef = { current: null };
    const args = baseArgs({ controllerRef });
    const { result } = renderHook(() => useMediaResilience(args));

    // Attempt 1 (resilience actor) opens a 4s cooldown window.
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(1);

    // Immediate user reload: inside the window, but user-initiated → fires,
    // and the attempt is recorded.
    act(() => controllerRef.current.forceReload({ reason: 'fitness-manual' }));
    expect(args.onReload).toHaveBeenCalledTimes(2);
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'fitness-manual' }));
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(2);
    // Gated recovery = same status machine as every other actor.
    expect(controllerRef.current.getState().status).toBe('recovering');

    // Because the bypassed attempt was RECORDED, the shared window moved:
    // past the original 4s window but inside the new 12s (attempt-2 backoff)
    // window, a non-bypass request is still denied…
    fakeNow += 4001;
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(2);

    // …and allowed once the pushed-forward window elapses.
    fakeNow += 8000; // 12001ms since the forceReload attempt
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(3);
  });

  it('does NOT fire when session-capped — the exhausted flow engages instead', () => {
    installLedger({ cooldownMs: 0 }); // isolate the session cap
    const controllerRef = { current: null };
    const args = baseArgs({ controllerRef });
    const { result } = renderHook(() => useMediaResilience(args));

    act(() => {
      for (let i = 0; i < 5; i += 1) result.current._testTriggerRecovery?.('playback-stalled');
    });
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).not.toHaveBeenCalled();

    // bypassCooldown does not override the session cap.
    act(() => controllerRef.current.forceReload({ reason: 'fitness-manual', seekToIntentMs: 5000 }));
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(controllerRef.current.getState().status).toBe('exhausted');
  });

  it('passes a caller-supplied seekToIntentMs through to onReload verbatim', () => {
    installLedger();
    const controllerRef = { current: null };
    const args = baseArgs({ controllerRef });
    renderHook(() => useMediaResilience(args));

    act(() => controllerRef.current.forceReload({ reason: 'fitness-stalled-seek', seekToIntentMs: 123456 }));
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'fitness-stalled-seek',
      seekToIntentMs: 123456,
      refreshUrl: false // 'fitness-stalled-seek' is not a URL-refresh reason
    }));
  });
});
