import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { chartRosterKey, useStableChartRoster, useStableSeriesGetter, useLatestCallback, useThrottledValue } from './chartLiveInputs.js';

afterEach(() => { vi.useRealTimers(); });

const entry = (over = {}) => ({ id: 'rider_a', profileId: 'rider_a', hrDeviceId: '1', name: 'A', zoneColor: '#0f0', isActive: true, heartRate: 120, ...over });

describe('chart live inputs (audit 2026-10-29: FitnessChart re-rendered 15–17/s)', () => {
  it('a heart-rate-only change keeps the same roster reference', () => {
    const first = [entry()];
    const { result, rerender } = renderHook(({ roster }) => useStableChartRoster(roster), { initialProps: { roster: first } });
    rerender({ roster: [entry({ heartRate: 121 })] });
    rerender({ roster: [entry({ heartRate: 133 })] });
    expect(result.current).toBe(first);
  });

  it('a drawn change (zone colour, activity, identity) hands the chart the new roster', () => {
    const { result, rerender } = renderHook(({ roster }) => useStableChartRoster(roster), { initialProps: { roster: [entry()] } });
    const zone = [entry({ zoneColor: '#f00' })];
    rerender({ roster: zone });
    expect(result.current).toBe(zone);
    const idle = [entry({ zoneColor: '#f00', isActive: false })];
    rerender({ roster: idle });
    expect(result.current).toBe(idle);
    expect(chartRosterKey([entry()])).not.toBe(chartRosterKey([entry({ profileId: 'guest_1' })]));
  });

  it('the series getter keeps its identity between ticks and reads the latest data', () => {
    let data = 1;
    const make = () => () => data;
    const { result, rerender } = renderHook(({ fn, tick }) => useStableSeriesGetter(fn, { tickCount: tick, sessionId: 's' }), { initialProps: { fn: make(), tick: 3 } });
    const first = result.current;
    rerender({ fn: make(), tick: 3 });
    expect(result.current).toBe(first);
    data = 2;
    expect(result.current()).toBe(2);
    rerender({ fn: make(), tick: 4 });
    expect(result.current).not.toBe(first);
    const { result: none } = renderHook(() => useStableSeriesGetter(undefined, { tickCount: 1 }));
    expect(none.current).toBeUndefined();
  });

  it('useLatestCallback is stable and calls the latest function', () => {
    const a = vi.fn(); const b = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useLatestCallback(fn), { initialProps: { fn: a } });
    const cb = result.current;
    rerender({ fn: b });
    expect(result.current).toBe(cb);
    cb(1);
    expect(b).toHaveBeenCalledWith(1);
    expect(a).not.toHaveBeenCalled();
    const { result: none } = renderHook(() => useLatestCallback(undefined));
    expect(none.current).toBeUndefined();
  });

  it('throttles the live legend map to one update per window, keeping the last value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 1000), { initialProps: { v: 'a' } });
    expect(result.current).toBe('a');
    rerender({ v: 'b' });            // first change: emitted at once
    expect(result.current).toBe('b');
    rerender({ v: 'c' });
    rerender({ v: 'd' });
    expect(result.current).toBe('b');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe('d');
  });
});
