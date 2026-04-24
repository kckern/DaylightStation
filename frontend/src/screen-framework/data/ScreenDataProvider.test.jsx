import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ScreenDataProvider, useScreenData } from './ScreenDataProvider.jsx';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function wrapper(sources) {
  return ({ children }) => (
    <ScreenDataProvider sources={sources}>{children}</ScreenDataProvider>
  );
}

describe('ScreenDataProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('provides fetched data via useScreenData hook', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ temp: 72 }),
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    const { result } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });

    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toEqual({ temp: 72 });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/home/weather');
  });

  it('deduplicates calls when two hooks use the same source key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ temp: 72 }),
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    // Both hooks share one provider, so only one fetch should occur
    const { result } = renderHook(
      () => ({
        a: useScreenData('weather'),
        b: useScreenData('weather'),
      }),
      { wrapper: wrapper(sources) }
    );

    await waitFor(() => {
      expect(result.current.a).toEqual({ temp: 72 });
      expect(result.current.b).toEqual({ temp: 72 });
    });

    // Only one fetch, not two
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown data key', () => {
    const sources = {};
    const { result } = renderHook(() => useScreenData('nonexistent'), {
      wrapper: wrapper(sources),
    });

    expect(result.current).toBeNull();
  });

  it('refreshes data on interval', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ temp: 70 + callCount }),
      });
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    const { result } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });

    // Flush the initial fetch (promise microtasks)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toEqual({ temp: 71 });

    // Advance past the refresh interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(result.current).toEqual({ temp: 72 });

    vi.useRealTimers();
  });

  it('exposes useScreenDataRefetch() which re-fetches a single key', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ temp: 70 + callCount }),
      });
    });

    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');

    const { result } = renderHook(
      () => ({ data: useScreenData('weather'), refetch: useScreenDataRefetch() }),
      { wrapper: wrapper(sources) }
    );

    await waitFor(() => { expect(result.current.data).toEqual({ temp: 71 }); });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.refetch('weather'); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await waitFor(() => { expect(result.current.data).toEqual({ temp: 72 }); });
  });

  it('refetch is a no-op for an unknown key', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');
    const { result } = renderHook(() => useScreenDataRefetch(), { wrapper: wrapper(sources) });
    await waitFor(() => { expect(mockFetch).toHaveBeenCalledTimes(1); });
    await act(async () => { await result.current('unknown-key'); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetch identity is stable across store updates', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');
    const { result } = renderHook(
      () => ({ data: useScreenData('weather'), refetch: useScreenDataRefetch() }),
      { wrapper: wrapper(sources) }
    );
    const firstRefetch = result.current.refetch;
    await waitFor(() => { expect(result.current.data).toEqual({ temp: 72 }); });
    expect(result.current.refetch).toBe(firstRefetch);
  });
});
