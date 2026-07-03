import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useMetronomeClick } from './useMetronomeClick.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useMetronomeClick', () => {
  it('ticks at the tempo while enabled', () => {
    const ticks = [];
    renderHook(() => useMetronomeClick({ enabled: true, bpm: 120, onTick: () => ticks.push(1) }));
    act(() => vi.advanceTimersByTime(1000)); // 120bpm → 500ms → 2 ticks
    expect(ticks.length).toBe(2);
  });

  it('stops ticking when disabled', () => {
    const ticks = [];
    const { rerender } = renderHook(({ on }) => useMetronomeClick({ enabled: on, bpm: 120, onTick: () => ticks.push(1) }), { initialProps: { on: true } });
    act(() => vi.advanceTimersByTime(1000));
    expect(ticks.length).toBe(2);
    rerender({ on: false });
    act(() => vi.advanceTimersByTime(2000));
    expect(ticks.length).toBe(2); // no more ticks
  });

  it('does not tick when disabled from the start', () => {
    const ticks = [];
    renderHook(() => useMetronomeClick({ enabled: false, bpm: 120, onTick: () => ticks.push(1) }));
    act(() => vi.advanceTimersByTime(2000));
    expect(ticks.length).toBe(0);
  });
});
