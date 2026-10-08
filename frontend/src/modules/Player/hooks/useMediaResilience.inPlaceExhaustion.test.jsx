import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests, RECOVERY_MAX_ATTEMPTS } from '../lib/recoveryLedger.js';

// A stream aborted at the network layer (hls.js fatal networkError) is recovered
// IN PLACE by the renderer's hardReset: the Player does not remount, so status
// stays `recovering` and nothing re-arms the startup deadline. The ladder used
// to stop after two attempts (startup -> recovering was the only status change)
// and the item stalled forever instead of reaching exhaustion.

let fakeNow;
beforeEach(() => {
  vi.useFakeTimers();
  fakeNow = 1_000_000;
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow }));
});
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('useMediaResilience: in-place recovery that never produces a frame', () => {
  it('keeps re-arming the startup deadline until the attempt cap, then reports exhaustion', () => {
    const args = {
      onReload: vi.fn(), // in-place hardReset: no remount, no status change
      onExhausted: vi.fn(),
      meta: { mediaType: 'hls_video', contentId: 'live:1' },
      waitKey: 'test:inplace',
      playbackSessionKey: 'session-inplace',
      disabled: false,
      getMediaEl: () => null,
      seconds: 0,
    };
    renderHook(() => useMediaResilience(args));
    // Each deadline is 15s; the ledger cooldown grows (4s x3^n) but is shorter
    // than the 15s re-arm until late attempts, so step generously.
    for (let i = 0; i < 40; i += 1) {
      fakeNow += 20_000;
      act(() => { vi.advanceTimersByTime(20_000); });
    }
    expect(args.onReload).toHaveBeenCalledTimes(RECOVERY_MAX_ATTEMPTS);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'startup-deadline-exceeded' }));
  });
});

describe('useMediaResilience: autoplay blocked', () => {
  it('holds the deadline and spends no recovery attempt while the browser waits for a tap', () => {
    const args = {
      onReload: vi.fn(), onExhausted: vi.fn(),
      meta: { mediaType: 'hls_video', contentId: 'live:1' },
      waitKey: 'test:autoplay', playbackSessionKey: 'session-autoplay',
      disabled: false, getMediaEl: () => null, seconds: 0, autoplayBlocked: true,
    };
    renderHook(() => useMediaResilience(args));
    for (let i = 0; i < 20; i += 1) {
      fakeNow += 20_000;
      act(() => { vi.advanceTimersByTime(20_000); });
    }
    expect(args.onReload).not.toHaveBeenCalled();
    expect(args.onExhausted).not.toHaveBeenCalled();
  });
});
