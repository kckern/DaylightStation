import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePressHoldOffer, HOLD_MS, OFFER_MS } from './usePressHoldOffer.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('usePressHoldOffer (PLAY.5a/AC3)', () => {
  it('a quick press is the ordinary verb: no offer, the click runs', () => {
    const run = vi.fn();
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS - 50); });
    act(() => result.current.bind.onPointerUp());
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    expect(result.current.offered).toBe(false);
    act(() => result.current.guardClick(run)({}));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('holding offers "at the very front" and the release click does NOT run Play next', () => {
    const run = vi.fn();
    const onOffered = vi.fn();
    const { result } = renderHook(() => usePressHoldOffer({ onOffered }));
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(result.current.offered).toBe(true);
    expect(onOffered).toHaveBeenCalledTimes(1);
    act(() => result.current.bind.onPointerUp());
    act(() => result.current.guardClick(run)({ preventDefault() {}, stopPropagation() {} }));
    expect(run).not.toHaveBeenCalled();
    // The next, ordinary click works again.
    act(() => result.current.guardClick(run)({}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.offered).toBe(false);
  });

  it('a held Space (keyboard) offers it too; key repeat does not restart the hold', () => {
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onKeyDown({ key: ' ', repeat: false }));
    act(() => result.current.bind.onKeyDown({ key: ' ', repeat: true }));
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(result.current.offered).toBe(true);
  });

  it('the offer lapses by itself and can be dismissed', () => {
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    act(() => { vi.advanceTimersByTime(OFFER_MS + 10); });
    expect(result.current.offered).toBe(false);
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    act(() => result.current.dismiss());
    expect(result.current.offered).toBe(false);
  });

  it('a hold released OFF the element does not swallow the next ordinary tap', () => {
    const run = vi.fn();
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(result.current.offered).toBe(true);
    act(() => result.current.bind.onPointerLeave()); // finger slid off; no click follows
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => result.current.guardClick(run)({}));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the release click right after a hold is still swallowed', () => {
    const run = vi.fn();
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onPointerDown());
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    act(() => result.current.bind.onPointerUp());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => result.current.guardClick(run)({}));
    expect(run).not.toHaveBeenCalled();
  });

  it('Enter never arms the hold (it clicks on keydown, so Play next already ran)', () => {
    const run = vi.fn();
    const { result } = renderHook(() => usePressHoldOffer());
    act(() => result.current.bind.onKeyDown({ key: 'Enter', repeat: false }));
    act(() => result.current.guardClick(run)({})); // the native click on keydown
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(result.current.offered).toBe(false);
    act(() => result.current.bind.onKeyUp({ key: 'Enter' }));
    act(() => result.current.guardClick(run)({}));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
