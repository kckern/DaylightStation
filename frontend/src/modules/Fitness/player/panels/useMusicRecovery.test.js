import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMusicRecovery } from './useMusicRecovery.js';

const BASE = {
  hasTrack: false,
  playlistId: 672596,
  recoverableError: false,
  thresholdMs: 15_000,
  retryDelayMs: 1_000,
  maxAutoRetries: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useMusicRecovery', () => {
  it('is idle when no playlist is selected', () => {
    const { result } = renderHook(() => useMusicRecovery({ ...BASE, playlistId: null }));
    expect(result.current.attempt).toBe(0);
    expect(result.current.isRecovering).toBe(false);
    expect(result.current.exhausted).toBe(false);
  });

  it('reports isRecovering while a playlist is loading with no track', () => {
    const { result } = renderHook(() => useMusicRecovery(BASE));
    expect(result.current.isRecovering).toBe(true);
    expect(result.current.exhausted).toBe(false);
  });

  it('auto-retries on silent stall up to maxAutoRetries, then exhausts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery(BASE));

    // First stall: threshold + retry delay → attempt 1
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(1);
    expect(result.current.exhausted).toBe(false);

    // Second stall → attempt 2 (budget now spent: maxAutoRetries = 2)
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(false);

    // Third stall: no budget left → exhausted, attempt unchanged
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(true);
    expect(result.current.isRecovering).toBe(false);
  });

  it('retries promptly on a recoverable error without waiting the stall threshold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery({ ...BASE, recoverableError: true }));

    // Only the retry delay elapses — far less than the 15s stall threshold.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.attempt).toBe(1);
  });

  it('resets the retry budget once a track is playing', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => useMusicRecovery(props), { initialProps: BASE });

    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(1);

    // Track loads → recovering ends, budget resets.
    rerender({ ...BASE, hasTrack: true });
    expect(result.current.isRecovering).toBe(false);
    expect(result.current.exhausted).toBe(false);

    // Track drops again → a fresh budget is available (attempt keeps climbing).
    rerender({ ...BASE, hasTrack: false });
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(false);
  });

  it('manual retry clears exhaustion and restores the budget', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery(BASE));

    // Drive to exhaustion.
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.exhausted).toBe(true);

    act(() => { result.current.retry(); });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.attempt).toBe(3);

    // Budget restored: it auto-retries again instead of staying exhausted.
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(4);
    expect(result.current.exhausted).toBe(false);
  });

  it('clears timers on unmount without firing late state updates', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useMusicRecovery(BASE));
    unmount();
    // A stall timer was in flight; unmount cleanup must cancel it.
    expect(() => { vi.runAllTimers(); }).not.toThrow();
  });

  it('spends the budget at the retry cadence while a recoverable error persists', () => {
    vi.useFakeTimers();
    // recoverableError stays true (the consumer never clears it) → each retry
    // delay spends one budget unit until the budget (maxAutoRetries = 2) is gone.
    const { result } = renderHook(() => useMusicRecovery({ ...BASE, recoverableError: true }));

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.attempt).toBe(1);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.attempt).toBe(2);

    // Budget spent → next failure detection exhausts (no further attempt bump).
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(true);
  });
});
