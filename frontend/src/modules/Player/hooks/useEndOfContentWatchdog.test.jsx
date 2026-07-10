import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEndOfContentWatchdog } from './useEndOfContentWatchdog.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

describe('useEndOfContentWatchdog', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('fires onAdvance after idleMs of paused-at-duration once an event nudges the watchdog', () => {
    const el = makeFakeEl({ currentTime: 441.76, duration: 441.76, paused: true, seeking: true });
    const mediaRef = { current: el };
    const onAdvance = vi.fn();
    renderHook(() =>
      useEndOfContentWatchdog({ mediaRef, sourceKey: 'src-a', onAdvance, idleMs: 3000 })
    );
    // Any of timeupdate/pause/play/seeked arms the watchdog.
    act(() => { el._fire('seeked'); });
    expect(onAdvance).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(2999); });
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not fire when video is playing', () => {
    const el = makeFakeEl({ currentTime: 441.76, duration: 441.76, paused: false });
    const onAdvance = vi.fn();
    renderHook(() =>
      useEndOfContentWatchdog({ mediaRef: { current: el }, sourceKey: 'src-a', onAdvance, idleMs: 3000 })
    );
    act(() => { el._fire('timeupdate'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not fire when currentTime is far from duration', () => {
    const el = makeFakeEl({ currentTime: 100, duration: 441.76, paused: true });
    const onAdvance = vi.fn();
    renderHook(() =>
      useEndOfContentWatchdog({ mediaRef: { current: el }, sourceKey: 'src-a', onAdvance, idleMs: 3000 })
    );
    act(() => { el._fire('pause'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('cancels the pending fire when the user scrubs away from the end', () => {
    const el = makeFakeEl({ currentTime: 441.7, duration: 441.76, paused: true });
    const onAdvance = vi.fn();
    renderHook(() =>
      useEndOfContentWatchdog({ mediaRef: { current: el }, sourceKey: 'src-a', onAdvance, idleMs: 3000 })
    );
    act(() => { el._fire('seeked'); }); // arm
    act(() => { vi.advanceTimersByTime(2000); });
    // User scrubs back to middle.
    el.currentTime = 200;
    el.paused = true;
    act(() => { el._fire('seeked'); }); // disarm (not at duration anymore)
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('resets monitoring when sourceKey changes (different asset)', () => {
    const el = makeFakeEl({ currentTime: 441.76, duration: 441.76, paused: true });
    const onAdvance = vi.fn();
    const mediaRef = { current: el };
    const { rerender } = renderHook(
      ({ sourceKey }) => useEndOfContentWatchdog({ mediaRef, sourceKey, onAdvance, idleMs: 3000 }),
      { initialProps: { sourceKey: 'src-a' } }
    );
    act(() => { el._fire('seeked'); });
    act(() => { vi.advanceTimersByTime(1000); });
    // New asset — state for src-a should be torn down.
    rerender({ sourceKey: 'src-b' });
    act(() => { vi.advanceTimersByTime(5000); });
    // The teardown of src-a removed the listeners, so no fire from the
    // src-a arming. The src-b setup attached fresh listeners but no event
    // has nudged the watchdog yet.
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('removes listeners on unmount', () => {
    const el = makeFakeEl({ currentTime: 441.76, duration: 441.76, paused: true });
    const { unmount } = renderHook(() =>
      useEndOfContentWatchdog({ mediaRef: { current: el }, sourceKey: 'src-a', onAdvance: vi.fn(), idleMs: 3000 })
    );
    expect(el._listeners.timeupdate?.length).toBe(1);
    expect(el._listeners.pause?.length).toBe(1);
    expect(el._listeners.play?.length).toBe(1);
    expect(el._listeners.seeked?.length).toBe(1);
    unmount();
    expect(el._listeners.timeupdate?.length ?? 0).toBe(0);
    expect(el._listeners.pause?.length ?? 0).toBe(0);
    expect(el._listeners.play?.length ?? 0).toBe(0);
    expect(el._listeners.seeked?.length ?? 0).toBe(0);
  });

  it('always reads the latest onAdvance callback', () => {
    const el = makeFakeEl({ currentTime: 441.76, duration: 441.76, paused: true });
    // Use a stable mediaRef across rerenders (mirrors a real useRef).
    const mediaRef = { current: el };
    const onAdvanceA = vi.fn();
    const onAdvanceB = vi.fn();
    const { rerender } = renderHook(
      ({ onAdvance }) => useEndOfContentWatchdog({ mediaRef, sourceKey: 'src-a', onAdvance, idleMs: 3000 }),
      { initialProps: { onAdvance: onAdvanceA } }
    );
    act(() => { el._fire('seeked'); }); // arm
    // Caller swaps to a new callback before the timer fires.
    rerender({ onAdvance: onAdvanceB });
    act(() => { vi.advanceTimersByTime(3001); });
    expect(onAdvanceA).not.toHaveBeenCalled();
    expect(onAdvanceB).toHaveBeenCalledTimes(1);
  });
});
