import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const post = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => post(...args) }));

import { useBpmPublisher } from './useBpmPublisher.js';

const flushMicrotasks = () => act(async () => { await Promise.resolve(); });

describe('useBpmPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
    post.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.useRealTimers());

  it('publishes the initial bpm immediately', () => {
    renderHook(() => useBpmPublisher({ bpm: 60 }));
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/bpm', { bpm: 60 }, 'POST');
  });

  it('does not re-publish an unchanged value', () => {
    const { rerender } = renderHook(({ bpm }) => useBpmPublisher({ bpm }), { initialProps: { bpm: 60 } });
    rerender({ bpm: 60 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('collapses rapid changes into one trailing post with the LATEST value (no storm)', () => {
    const { rerender } = renderHook(({ bpm }) => useBpmPublisher({ bpm }), { initialProps: { bpm: 60 } });
    expect(post).toHaveBeenCalledTimes(1);
    rerender({ bpm: 100 });
    rerender({ bpm: 110 });
    rerender({ bpm: 128 });
    expect(post).toHaveBeenCalledTimes(1); // window still open
    act(() => vi.advanceTimersByTime(5000));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('api/v1/fitness/dance/bpm', { bpm: 128 }, 'POST');
  });

  it('publishes immediately when the window has already elapsed', () => {
    const { rerender } = renderHook(({ bpm }) => useBpmPublisher({ bpm }), { initialProps: { bpm: 60 } });
    act(() => vi.advanceTimersByTime(6000));
    rerender({ bpm: 128 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('api/v1/fitness/dance/bpm', { bpm: 128 }, 'POST');
  });

  it('ignores null/invalid bpm and respects enabled=false', () => {
    renderHook(() => useBpmPublisher({ bpm: null }));
    renderHook(() => useBpmPublisher({ bpm: NaN }));
    renderHook(() => useBpmPublisher({ bpm: 120, enabled: false }));
    expect(post).not.toHaveBeenCalled();
  });

  it('retries a failed publish on the next change', async () => {
    post.mockRejectedValueOnce(new Error('backend down'));
    const { rerender } = renderHook(({ bpm }) => useBpmPublisher({ bpm }), { initialProps: { bpm: 60 } });
    await flushMicrotasks();
    expect(post).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(6000));
    rerender({ bpm: 60.0001 }); // any change re-triggers; failed value was cleared
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('cancels the trailing timer on unmount', () => {
    const { rerender, unmount } = renderHook(({ bpm }) => useBpmPublisher({ bpm }), { initialProps: { bpm: 60 } });
    rerender({ bpm: 128 });
    unmount();
    act(() => vi.advanceTimersByTime(10000));
    expect(post).toHaveBeenCalledTimes(1); // only the initial post
  });
});
