import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibleRefresh } from './useVisibleRefresh.js';

describe('useVisibleRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes once on foreground, suspends hidden work and releases its timer', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const reload = vi.fn();
    const hook = renderHook(({ active }) => useVisibleRefresh({ active, reload, intervalMs: 100 }), {
      initialProps: { active: true },
    });
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(500);
    expect(reload).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(2);
    hook.rerender({ active: false });
    vi.advanceTimersByTime(500);
    expect(reload).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the periodic callback on ticks and still reloads immediately in the foreground', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const reload = vi.fn();
    const poll = vi.fn();
    const hook = renderHook(() => useVisibleRefresh({ intervalMs: 100, reload, poll }));
    vi.advanceTimersByTime(100);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(100);
    expect(poll).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(poll).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the idle poll on visible window focus only while the opted-in view is active', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const reload = vi.fn();
    const poll = vi.fn();
    const focus = () => window.dispatchEvent(new Event('focus'));
    const hook = renderHook(({ active }) => useVisibleRefresh({ active, reload, poll, refreshOnFocus: true }), {
      initialProps: { active: true },
    });
    focus();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    focus();
    expect(poll).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
    focus();
    expect(poll).toHaveBeenCalledTimes(2);

    hook.rerender({ active: false });
    focus();
    expect(poll).toHaveBeenCalledTimes(2);
    hook.rerender({ active: true });
    hook.unmount();
    focus();
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
