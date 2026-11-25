import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useCountIn } from './useCountIn.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useCountIn', () => {
  it('ticks beat numbers, schedules one blip per beat, fires onGo at the end', () => {
    vi.useFakeTimers();
    const blips = [];
    const onGo = vi.fn();
    const { result } = renderHook(() => useCountIn({ onGo, scheduleBlip: (offsetS) => blips.push(offsetS) }));

    act(() => result.current.start({ beats: 4, periodMs: 500 }));
    expect(result.current.active).toBe(true);
    expect(result.current.beat).toBe(1);
    expect(blips).toHaveLength(4); // all four beats scheduled up front on the audio clock

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.beat).toBe(2);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.beat).toBe(3);

    expect(onGo).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000)); // through beats 4 and end
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
  });

  it('plans the count on one clock: each blip and the go carry their performance-clock instant', () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const blips = [];
    const onGo = vi.fn();
    const { result } = renderHook(() => useCountIn({ onGo, scheduleBlip: (offsetS, at) => blips.push(at) }));
    act(() => result.current.start({ beats: 3, periodMs: 500, leadMs: 2 }));
    expect(blips).toEqual([{ perfMs: 1000, leadMs: 2 }, { perfMs: 1500, leadMs: 2 }, { perfMs: 2000, leadMs: 2 }]); // no WebAudio here: no start delay
    act(() => vi.advanceTimersByTime(1500));
    expect(onGo).toHaveBeenCalledWith({ atPerfMs: 2500 });
    now.mockRestore();
  });

  it('cancel stops everything and never fires onGo', () => {
    vi.useFakeTimers();
    const onGo = vi.fn();
    const { result } = renderHook(() => useCountIn({ onGo, scheduleBlip: () => {} }));
    act(() => result.current.start({ beats: 4, periodMs: 500 }));
    act(() => vi.advanceTimersByTime(600));
    act(() => result.current.cancel());
    expect(result.current.active).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(onGo).not.toHaveBeenCalled();
  });

  it('clears timers on unmount (no late onGo)', () => {
    vi.useFakeTimers();
    const onGo = vi.fn();
    const { result, unmount } = renderHook(() => useCountIn({ onGo, scheduleBlip: () => {} }));
    act(() => result.current.start({ beats: 4, periodMs: 500 }));
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(onGo).not.toHaveBeenCalled();
  });
});
