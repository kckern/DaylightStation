import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience, shouldRefreshUrlForReason } from './useMediaResilience.js';

// ---------------------------------------------------------------------------
// Pure-function tests — no React needed
// ---------------------------------------------------------------------------

describe('shouldRefreshUrlForReason', () => {
  it('returns true for startup-deadline reasons', () => {
    expect(shouldRefreshUrlForReason('startup-deadline-exceeded')).toBe(true);
    expect(shouldRefreshUrlForReason('startup-deadline-exceeded-after-warmup')).toBe(true);
    expect(shouldRefreshUrlForReason('stale-session-detected')).toBe(true);
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
    // Disable startup deadline monitoring so the hook doesn't blow up
    // trying to arm timers against a real media element in a unit test.
    disabled: false,
    getMediaEl: () => null,
    recoveryCooldownMs: 0,
    maxAttempts: 5,
    configOverrides: {
      monitorSettings: {
        recoveryCooldownMs: 0,
        recoveryCooldownBackoffMultiplier: 1,
        hardRecoverLoadingGraceMs: 0,
        epsilonSeconds: 1,
      },
      recoveryConfig: { maxAttempts: 5 }
    }
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
