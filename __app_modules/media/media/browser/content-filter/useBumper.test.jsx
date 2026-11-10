import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../frontend/src/lib/logging/singleton.js", () => ({ getChildLogger: () => mockLogger }));
import { useBumper } from './useBumper.js';

function el(t = 0, paused = true) {
  const target = new EventTarget();
  return Object.assign(target, { currentTime: t, paused });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('useBumper', () => {
  it('shows on the first play from the start, then hides after holdMs', () => {
    const v = el(0);
    const { result } = renderHook(() => useBumper({ getMediaEl: () => v, enabled: true, holdMs: 4000 }));
    expect(result.current).toBe(false);
    act(() => { v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith('content-filter.bumper.shown', expect.any(Object));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(result.current).toBe(false);
  });
  it('does not show on a resume past the start window', () => {
    const v = el(1200);
    const { result } = renderHook(() => useBumper({ getMediaEl: () => v, enabled: true }));
    act(() => { v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(false);
  });
  it('shows only once per mount', () => {
    const v = el(0);
    const { result } = renderHook(() => useBumper({ getMediaEl: () => v, enabled: true, holdMs: 10 }));
    act(() => { v.dispatchEvent(new Event('playing')); vi.advanceTimersByTime(10); });
    act(() => { v.currentTime = 0; v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(false);
  });
  it('evaluates immediately when the element is already playing at mount', () => {
    const v = el(0.5, false);
    const { result } = renderHook(() => useBumper({ getMediaEl: () => v, enabled: true }));
    expect(result.current).toBe(true);
  });
  it('never shows when disabled', () => {
    const v = el(0);
    const { result } = renderHook(() => useBumper({ getMediaEl: () => v, enabled: false }));
    act(() => { v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(false);
  });
  it('binds to an element that appears after mount, with a stable getMediaEl', () => {
    let current = null;
    const getMediaEl = () => current;
    const { result, rerender } = renderHook(() => useBumper({ getMediaEl, enabled: true }));
    const v = el(0);
    current = v;
    rerender();
    act(() => { v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(true);
  });
  it('shows when enabled turns on after mount (filter data arrived)', () => {
    const v = el(0);
    const { result, rerender } = renderHook(({ on }) => useBumper({ getMediaEl: () => v, enabled: on }), { initialProps: { on: false } });
    rerender({ on: true });
    act(() => { v.dispatchEvent(new Event('playing')); });
    expect(result.current).toBe(true);
  });
});
