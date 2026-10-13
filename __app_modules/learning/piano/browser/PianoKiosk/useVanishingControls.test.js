import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useVanishingControls from './useVanishingControls.js';

describe('useVanishingControls', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts visible and hides only after the 20s idle default', () => {
    const { result } = renderHook(() => useVanishingControls({ active: true }));
    expect(result.current.visible).toBe(true);

    act(() => { vi.advanceTimersByTime(19999); });
    expect(result.current.visible).toBe(true); // still visible just before 20s

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.visible).toBe(false); // hidden at 20s
  });

  it('reveal() re-arms the idle timer', () => {
    const { result } = renderHook(() => useVanishingControls({ active: true }));
    act(() => { vi.advanceTimersByTime(15000); });
    act(() => { result.current.reveal(); });          // activity resets the clock
    expect(result.current.visible).toBe(true);

    act(() => { vi.advanceTimersByTime(19999); });
    expect(result.current.visible).toBe(true);        // 15s already elapsed, but timer restarted
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.visible).toBe(false);
  });

  it('stays visible while not active (paused/stopped)', () => {
    const { result } = renderHook(() => useVanishingControls({ active: false }));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(result.current.visible).toBe(true);
  });

  it('honors an explicit idleMs override', () => {
    const { result } = renderHook(() => useVanishingControls({ active: true, idleMs: 5000 }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.visible).toBe(false);
  });
});
