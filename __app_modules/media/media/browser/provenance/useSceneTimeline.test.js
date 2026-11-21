import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSceneTimeline, pickLinkMs, SCENE_TIMING } from './useSceneTimeline.js';

const T = SCENE_TIMING;

describe('pickLinkMs', () => {
  it('spans 5 to 10 seconds', () => {
    expect(pickLinkMs(T, () => 0)).toBe(5000);
    expect(pickLinkMs(T, () => 0.999999)).toBe(10000);
    expect(pickLinkMs(T, () => 0.5)).toBe(7500);
  });
});

describe('useSceneTimeline', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = (stage) => renderHook((p) => useSceneTimeline(p.stage), { initialProps: { stage } });

  it('shows nothing before the intro covers', () => {
    for (const stage of ['off', 'waiting', undefined]) {
      expect(setup(stage).result.current).toBeNull();
    }
  });

  it('links while the intro covers or holds', () => {
    const { result, rerender } = setup('covering');
    expect(result.current).toBe('linking');
    rerender({ stage: 'holding' });
    expect(result.current).toBe('linking');
  });

  it('runs linked -> docked -> leaving -> done once the film plays', () => {
    const { result, rerender } = setup('holding');
    rerender({ stage: 'playing' });
    expect(result.current).toBe('linked');
    act(() => { vi.advanceTimersByTime(T.linkedMs - 1); });
    expect(result.current).toBe('linked');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('docked');
    act(() => { vi.advanceTimersByTime(T.dockMs); });
    expect(result.current).toBe('leaving');
    act(() => { vi.advanceTimersByTime(T.leaveMs); });
    expect(result.current).toBe('done');
  });

  it('clears its timers on unmount', () => {
    const { rerender, unmount } = setup('covering');
    rerender({ stage: 'playing' });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops back to nothing if the stage leaves playing', () => {
    const { result, rerender } = setup('playing');
    expect(result.current).toBe('linked');
    rerender({ stage: 'off' });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
