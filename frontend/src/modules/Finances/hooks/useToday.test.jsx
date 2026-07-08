import { renderHook, act } from '@testing-library/react';
import { useToday } from './useToday.mjs';

describe('useToday', () => {
  test('returns today and rolls over when the calendar day changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T23:59:30'));
    const { result } = renderHook(() => useToday(1000));
    expect(result.current).toBe('2026-03-05');

    act(() => {
      vi.setSystemTime(new Date('2026-03-06T00:00:10'));
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe('2026-03-06');
    vi.useRealTimers();
  });

  test('same-day ticks do not change the value identity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T10:00:00'));
    const { result } = renderHook(() => useToday(1000));
    const first = result.current;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(first);
    vi.useRealTimers();
  });
});
