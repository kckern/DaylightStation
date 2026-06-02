/**
 * useCycleSuccessHold — keep the cycle overlay visible briefly on success (§5A).
 *
 * The HR challenge overlay holds for CHALLENGE_SUCCESS_HOLD_MS on success (✅ +
 * completion ring) instead of vanishing. This hook ports that hold to the cycle
 * challenge: when the cycle challenge transitions to 'success' it captures the
 * snapshot and reports `done: true` for the hold window, then dismisses. A given
 * challenge id triggers the hold at most once (no re-fire while the engine keeps
 * reporting success).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCycleSuccessHold } from './useCycleSuccessHold.js';
import { CHALLENGE_SUCCESS_HOLD_MS } from './ChallengeOverlay.jsx';

describe('useCycleSuccessHold', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const cycle = (status) => ({ id: 'c1', type: 'cycle', status, rider: { id: 'user_2', name: 'User_2' } });

  it('is not done while the challenge is pending', () => {
    const { result } = renderHook(({ c }) => useCycleSuccessHold(c), { initialProps: { c: cycle('pending') } });
    expect(result.current.done).toBe(false);
    expect(result.current.challenge).toBeNull();
  });

  it('holds done=true with the captured snapshot on success, then dismisses after the hold', () => {
    const { result, rerender } = renderHook(({ c }) => useCycleSuccessHold(c), { initialProps: { c: cycle('pending') } });
    act(() => { rerender({ c: cycle('success') }); });
    expect(result.current.done).toBe(true);
    expect(result.current.challenge).toMatchObject({ id: 'c1', status: 'success', rider: { id: 'user_2' } });

    act(() => { vi.advanceTimersByTime(CHALLENGE_SUCCESS_HOLD_MS + 1); });
    expect(result.current.done).toBe(false);
    expect(result.current.challenge).toBeNull();
  });

  it('does not re-fire the hold while the engine keeps reporting the same success', () => {
    const { result, rerender } = renderHook(({ c }) => useCycleSuccessHold(c), { initialProps: { c: cycle('success') } });
    expect(result.current.done).toBe(true);
    act(() => { vi.advanceTimersByTime(CHALLENGE_SUCCESS_HOLD_MS + 1); });
    expect(result.current.done).toBe(false);
    // Still success on later ticks → must stay dismissed (no loop).
    act(() => { rerender({ c: cycle('success') }); });
    act(() => { vi.advanceTimersByTime(CHALLENGE_SUCCESS_HOLD_MS + 1); });
    expect(result.current.done).toBe(false);
  });

  it('survives the challenge being nulled after success (snapshot was captured)', () => {
    const { result, rerender } = renderHook(({ c }) => useCycleSuccessHold(c), { initialProps: { c: cycle('pending') } });
    act(() => { rerender({ c: cycle('success') }); });
    act(() => { rerender({ c: null }); });
    expect(result.current.done).toBe(true);
    expect(result.current.challenge).toMatchObject({ id: 'c1', status: 'success' });
  });
});
