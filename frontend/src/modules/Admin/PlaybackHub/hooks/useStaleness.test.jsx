import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStaleness } from './useStaleness.js';

describe('useStaleness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports not-stale for a fresh timestamp', () => {
    const now = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(now);
    const { result } = renderHook(() => useStaleness(now, { staleAfterMs: 10000 }));
    expect(result.current.isStale).toBe(false);
    expect(result.current.secondsSinceUpdate).toBe(0);
  });

  it('reports stale after staleAfterMs elapses', () => {
    const t0 = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(t0);
    const { result } = renderHook(() => useStaleness(t0, { staleAfterMs: 10000, tickMs: 1000 }));
    expect(result.current.isStale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current.isStale).toBe(true);
    expect(result.current.secondsSinceUpdate).toBeGreaterThanOrEqual(15);
  });

  it('reports isStale=true when fetchedAt is null (never received a snapshot)', () => {
    const { result } = renderHook(() => useStaleness(null, { staleAfterMs: 10000 }));
    expect(result.current.isStale).toBe(true);
    expect(result.current.secondsSinceUpdate).toBeNull();
  });

  it('updates secondsSinceUpdate as time passes', () => {
    const t0 = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(t0);
    const { result } = renderHook(() => useStaleness(t0, { staleAfterMs: 10000, tickMs: 1000 }));
    expect(result.current.secondsSinceUpdate).toBe(0);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.secondsSinceUpdate).toBeGreaterThanOrEqual(3);
  });
});
