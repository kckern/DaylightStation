import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useScoreTransport } from './useScoreTransport.js';

// Drive rAF off the fake-timer clock so vi.advanceTimersByTime moves playback.
// performance.now() shares the fake system clock (no skew vs the rAF timestamp).
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.setSystemTime(0);
});
afterEach(() => {
  cleanup(); // unmount hooks while the rAF stubs + fake timers are still active
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TL = [
  { t: 0, index: 0 }, { t: 500, index: 1 }, { t: 1000, index: 2 }, { t: 1500, index: 3 },
];

describe('useScoreTransport', () => {
  it('fires events at their absolute times (no per-step drift)', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));
    expect(fired).toEqual([0, 1]);
    act(() => vi.advanceTimersByTime(1100));
    expect(fired).toEqual([0, 1, 2, 3]);
  });

  it('finishes: stops playing and calls onDone after the last event', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: () => {}, onDone }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2000));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
  });

  it('pause holds position; resume does not replay or skip', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700)); // fired 0, 1
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(5000)); // paused — nothing fires
    expect(fired).toEqual([0, 1]);
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(320)); // 700 + 320 > 1000
    expect(fired).toEqual([0, 1, 2]);
  });

  it('seek repositions; the event AT the seek time fires on resume', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.seek(1000));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([2]);
  });

  it('stop resets to the top', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.stop());
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([0, 1, 0]);
  });
});
