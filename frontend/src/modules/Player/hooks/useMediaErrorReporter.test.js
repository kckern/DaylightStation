import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaErrorReporter } from './useMediaErrorReporter.js';

function makeMockEl() {
  const listeners = new Map();
  return {
    addEventListener: vi.fn((event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    }),
    removeEventListener: vi.fn((event, fn) => {
      const arr = listeners.get(event) || [];
      listeners.set(event, arr.filter(f => f !== fn));
    }),
    dispatch(event) {
      (listeners.get(event) || []).forEach(fn => fn());
    },
    error: null,
    networkState: 0,
    readyState: 0,
    currentSrc: '',
  };
}

describe('useMediaErrorReporter', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('calls onError with kind=media-error when the media element emits error', () => {
    const el = makeMockEl();
    el.error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
    const onError = vi.fn();
    renderHook(() => useMediaErrorReporter({
      getMediaEl: () => el,
      mediaKey: 'track-1',
      onError,
      mediaLoadTimeoutMs: null,
    }));
    act(() => { el.dispatch('error'); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'media-error',
      code: 4,
    }));
  });

  it('calls onError with kind=media-load-timeout when canplay does not fire in time', async () => {
    vi.useFakeTimers();
    const el = makeMockEl();
    const onError = vi.fn();
    renderHook(() => useMediaErrorReporter({
      getMediaEl: () => el,
      mediaKey: 'track-1',
      onError,
      mediaLoadTimeoutMs: 15_000,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'media-load-timeout',
      timeoutMs: 15_000,
    }));
  });

  it('does NOT fire media-load-timeout if canplay fires before threshold', async () => {
    vi.useFakeTimers();
    const el = makeMockEl();
    const onError = vi.fn();
    renderHook(() => useMediaErrorReporter({
      getMediaEl: () => el,
      mediaKey: 'track-1',
      onError,
      mediaLoadTimeoutMs: 15_000,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    act(() => { el.dispatch('canplay'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(onError).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'media-load-timeout' }));
  });

  it('re-arms the load timer when mediaKey changes (new track)', async () => {
    vi.useFakeTimers();
    const el = makeMockEl();
    const onError = vi.fn();
    const { rerender } = renderHook(
      ({ mediaKey }) => useMediaErrorReporter({
        getMediaEl: () => el,
        mediaKey,
        onError,
        mediaLoadTimeoutMs: 5_000,
      }),
      { initialProps: { mediaKey: 'track-1' } }
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    act(() => { el.dispatch('canplay'); }); // resolves track-1
    rerender({ mediaKey: 'track-2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_001); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'media-load-timeout' }));
    // Ensure the prior timer was cleaned up — a leaked timer would double-fire.
    const timeoutCalls = onError.mock.calls.filter(c => c[0]?.kind === 'media-load-timeout');
    expect(timeoutCalls).toHaveLength(1);
  });

  it('cleans up listeners on unmount', () => {
    const el = makeMockEl();
    const { unmount } = renderHook(() => useMediaErrorReporter({
      getMediaEl: () => el,
      mediaKey: 'track-1',
      onError: vi.fn(),
      mediaLoadTimeoutMs: 5_000,
    }));
    expect(el.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    unmount();
    expect(el.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('is a no-op when getMediaEl returns null', () => {
    const onError = vi.fn();
    const { unmount } = renderHook(() => useMediaErrorReporter({
      getMediaEl: () => null,
      mediaKey: 'track-1',
      onError,
      mediaLoadTimeoutMs: 5_000,
    }));
    expect(onError).not.toHaveBeenCalled();
    unmount();
  });
});
