import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience, shouldRefreshUrlForReason } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';

// ---------------------------------------------------------------------------
// Pure-function tests — no React needed
// ---------------------------------------------------------------------------

describe('shouldRefreshUrlForReason', () => {
  it('returns true for startup-deadline reasons', () => {
    expect(shouldRefreshUrlForReason('startup-deadline-exceeded')).toBe(true);
    expect(shouldRefreshUrlForReason('startup-deadline-exceeded-after-warmup')).toBe(true);
    expect(shouldRefreshUrlForReason('stale-session-detected')).toBe(true);
  });

  it('returns true for a seek-induced transcode-warming stall (needs a fresh session at the offset)', () => {
    expect(shouldRefreshUrlForReason('seek-stall-transcode-warming')).toBe(true);
  });

  it('returns false for other reasons', () => {
    expect(shouldRefreshUrlForReason('playback-stalled')).toBe(false);
    expect(shouldRefreshUrlForReason('buffer-exhausted')).toBe(false);
    expect(shouldRefreshUrlForReason('unknown-reason')).toBe(false);
    expect(shouldRefreshUrlForReason('')).toBe(false);
    expect(shouldRefreshUrlForReason(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook integration tests — verify refreshUrl is threaded through onReload
// ---------------------------------------------------------------------------

describe('useMediaResilience — refreshUrl signal in onReload', () => {
  const baseArgs = () => ({
    onReload: vi.fn(),
    meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
    waitKey: 'test:1',
    playbackSessionKey: `session-${Math.random()}`,
    // NOTE: meta lacks mediaType/plex/contentId keys, so the startup deadline
    // never arms in these tests. Attempt cap + cooldown are owned by the
    // recoveryLedger (not hook config), so there is nothing to override here.
    disabled: false,
    getMediaEl: () => null
  });

  it('sets refreshUrl:true for startup-deadline-exceeded', () => {
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current._testTriggerRecovery?.('startup-deadline-exceeded'));
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'startup-deadline-exceeded',
      refreshUrl: true
    }));
  });

  it('sets refreshUrl:true for stale-session-detected', () => {
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current._testTriggerRecovery?.('stale-session-detected'));
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stale-session-detected',
      refreshUrl: true
    }));
  });

  it('sets refreshUrl:false for playback-stalled (non-startup reason)', () => {
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'playback-stalled',
      refreshUrl: false
    }));
  });

  it('exposes _testTriggerRecovery only in non-production environments', () => {
    // NODE_ENV is 'test' in vitest, which is !== 'production', so _testTriggerRecovery must be present
    const args = baseArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    expect(typeof result.current._testTriggerRecovery).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Exhaustion retry — the user-clicks-"Restart playback" path. Must force a
// FRESH stream URL *and* escalate to a real React remount, because in-place
// reattach on a reaped Plex transcode session leaves the <video> wedged.
// Regression: dead-session / idle-reap (2026-05-22).
// ---------------------------------------------------------------------------

describe('useMediaResilience — retryFromExhausted (user retry after exhaustion)', () => {
  const exhaustionArgs = () => ({
    onReload: vi.fn(),
    meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
    waitKey: 'test:exhausted',
    playbackSessionKey: `session-${Math.random()}`,
    disabled: false,
    getMediaEl: () => null
  });

  it('exposes retryFromExhausted from the hook return (so Player can wire the button to it)', () => {
    const args = exhaustionArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    expect(typeof result.current.retryFromExhausted).toBe('function');
  });

  it('requests a FRESH stream URL and a REAL remount on user retry', () => {
    const args = exhaustionArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'user-retry-exhausted',
      refreshUrl: true,
      forceRemount: true
    }));
  });

  // `userInitiated` is the hook telling the Player "a human asked for this", which
  // exempts the remount from the Player's cancel-on-playing and fire-time brakes.
  // It must NOT be inferred from forceRemount downstream: the stall-jolt ladder
  // raises that automatically (stallJolt.js:33), and treating it as consent
  // reopened the 2026-09-01 post-success remount on the commonest stall path.
  it('declares userInitiated so the Player will not second-guess a viewer retry', () => {
    const args = exhaustionArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'user-retry-exhausted',
      userInitiated: true
    }));
  });

  it('does NOT declare userInitiated for an automatic recovery', () => {
    const args = exhaustionArgs();
    const { result } = renderHook(() => useMediaResilience(args));
    act(() => result.current._testTriggerRecovery?.('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload.mock.calls[0][0].userInitiated).toBeUndefined();
  });

  it('Retry opens a bounded incident while retaining every rolling debit', () => {
    let now = 1000000;
    const ledger = createRecoveryLedger({ now: () => now });
    _setSharedLedgerForTests(ledger);
    try {
      const args = exhaustionArgs();
      const { result } = renderHook(() => useMediaResilience(args));
      for (let i = 0; i < 3; i++) {
        act(() => result.current._testTriggerRecovery('playback-stalled'));
        ledger.completeAction({ sessionKey: args.playbackSessionKey, actionId: ledger.snapshot(args.playbackSessionKey).inFlightActionId });
        now += 4000;
      }
      expect(args.onReload).toHaveBeenCalledTimes(3);
      act(() => result.current._testTriggerRecovery('playback-stalled'));
      expect(args.onReload).toHaveBeenCalledTimes(3);
      act(() => result.current.retryFromExhausted());
      expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ refreshUrl: true, forceRemount: true, userInitiated: true }));
      expect(ledger.snapshot(args.playbackSessionKey)).toMatchObject({ count: 1, rollingCount: 4 });
      act(() => result.current._testTriggerRecovery('playback-stalled'));
      expect(args.onReload).toHaveBeenCalledTimes(4); // Retry still occupies the one slot.
    } finally { _setSharedLedgerForTests(null); }
  });
});
