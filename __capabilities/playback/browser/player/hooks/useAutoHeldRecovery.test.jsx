import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoHeldRecovery } from './useAutoHeldRecovery.js';
import { AUTO_RETRY_LIMIT, AUTO_RETRY_DELAY_SEC } from '../lib/heldRecoveryModel.js';

describe('useAutoHeldRecovery (a held video on a surface nobody can press)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down, retries, and after the limit moves to the next item', () => {
    const retry = vi.fn();
    const skip = vi.fn();
    const { result } = renderHook((p) => useAutoHeldRecovery(p), { initialProps: { active: true, mediaKey: 'a', retry, skip } });
    expect(result.current).toEqual({ attempt: 0, retryInSec: AUTO_RETRY_DELAY_SEC });
    for (let i = 1; i <= AUTO_RETRY_LIMIT; i += 1) {
      act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000); });
      expect(retry).toHaveBeenCalledTimes(i);
      expect(result.current.attempt).toBe(i);
    }
    act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000); });
    expect(skip).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(AUTO_RETRY_LIMIT);
  });

  it('stops after the limit when nothing is next', () => {
    const retry = vi.fn();
    renderHook((p) => useAutoHeldRecovery(p), { initialProps: { active: true, mediaKey: 'a', retry, skip: null } });
    act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000 * (AUTO_RETRY_LIMIT + 3)); });
    expect(retry).toHaveBeenCalledTimes(AUTO_RETRY_LIMIT);
  });

  it('does nothing while inactive, and a new item starts a fresh count', () => {
    const retry = vi.fn();
    const { result, rerender } = renderHook((p) => useAutoHeldRecovery(p), { initialProps: { active: false, mediaKey: 'a', retry, skip: null } });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(retry).not.toHaveBeenCalled();
    rerender({ active: true, mediaKey: 'a', retry, skip: null });
    act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000); });
    expect(result.current.attempt).toBe(1);
    rerender({ active: true, mediaKey: 'b', retry, skip: null });
    expect(result.current.attempt).toBe(0);
  });

  it('a refused retry (rolling cap) does not spend an attempt; it waits out the cooldown it was given', () => {
    const retry = vi.fn(() => ({ ok: false, code: 'rolling-cap', retryAfterMs: 5000 }));
    const { result } = renderHook((p) => useAutoHeldRecovery(p), { initialProps: { active: true, mediaKey: 'a', retry, skip: null } });
    act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ attempt: 0, retryInSec: 5 });
  });

  it('a recovery that holds for a minute starts the next stall with a fresh count', () => {
    const retry = vi.fn(() => ({ ok: true }));
    const { result, rerender } = renderHook((p) => useAutoHeldRecovery(p), { initialProps: { active: true, mediaKey: 'a', retry, skip: null } });
    act(() => { vi.advanceTimersByTime(AUTO_RETRY_DELAY_SEC * 1000); });
    expect(result.current.attempt).toBe(1);
    rerender({ active: false, mediaKey: 'a', retry, skip: null });
    act(() => { vi.advanceTimersByTime(61_000); });
    rerender({ active: true, mediaKey: 'a', retry, skip: null });
    expect(result.current.attempt).toBe(0);
  });
});
