import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useArmedAction } from './useArmedAction.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('useArmedAction', () => {
  it('arms on first trigger without running fn, fires on the second', () => {
    const fn = vi.fn(() => 'ran');
    const { result } = renderHook(() => useArmedAction(fn, { armMs: 3000 }));

    expect(result.current.armed).toBe(false);
    act(() => { result.current.trigger(); });
    expect(result.current.armed).toBe(true);
    expect(fn).not.toHaveBeenCalled();

    let out;
    act(() => { out = result.current.trigger(); });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out).toBe('ran');
    expect(result.current.armed).toBe(false);
  });

  it('auto-disarms after armMs without a confirming trigger', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useArmedAction(fn, { armMs: 3000 }));
    act(() => { result.current.trigger(); });
    expect(result.current.armed).toBe(true);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.armed).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reset() disarms immediately', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useArmedAction(fn));
    act(() => { result.current.trigger(); });
    act(() => { result.current.reset(); });
    expect(result.current.armed).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('forwards a promise result from fn on confirm', async () => {
    const fn = vi.fn(async () => ({ ok: false, lever: 'none' }));
    const { result } = renderHook(() => useArmedAction(fn));
    act(() => { result.current.trigger(); });
    let out;
    act(() => { out = result.current.trigger(); });
    await expect(out).resolves.toEqual({ ok: false, lever: 'none' });
  });
});
