import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ScreenDataProvider } from './ScreenDataProvider.jsx';
import { useScreenData } from './useScreenData.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function wrapper(sources) {
  return function Wrapper({ children }) {
    return <ScreenDataProvider sources={sources}>{children}</ScreenDataProvider>;
  };
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
    const { useScreenDataRefetch } = await import('./useScreenData.js');

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
    const { useScreenDataRefetch } = await import('./useScreenData.js');
    const { result } = renderHook(() => useScreenDataRefetch(), { wrapper: wrapper(sources) });
    await waitFor(() => { expect(mockFetch).toHaveBeenCalledTimes(1); });
    await act(async () => { await result.current('unknown-key'); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetch identity is stable across store updates', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./useScreenData.js');
    const { result } = renderHook(
      () => ({ data: useScreenData('weather'), refetch: useScreenDataRefetch() }),
      { wrapper: wrapper(sources) }
    );
    const firstRefetch = result.current.refetch;
    await waitFor(() => { expect(result.current.data).toEqual({ temp: 72 }); });
    expect(result.current.refetch).toBe(firstRefetch);
  });
});

describe('ScreenDataProvider persistence (stale-while-revalidate)', () => {
  const sources = { sessions: { source: '/api/v1/fitness/sessions?since=95d' } };
  const cacheKey = 'screenData:fitness:home:sessions';

  function persistWrapper(extra = {}) {
    return function Wrapper({ children }) {
      return (
        <ScreenDataProvider sources={sources} persistKey="fitness:home" persist={['sessions']} cacheVersion="v1" {...extra}>
          {children}
        </ScreenDataProvider>
      );
    };
  }

  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  it('renders the cached payload on the first render, then replaces it with the fetch', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v1', savedAt: 1, data: { sessions: ['old'] } }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: ['new'] }) });

    const { result } = renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    expect(result.current).toEqual({ sessions: ['old'] });
    await waitFor(() => expect(result.current).toEqual({ sessions: ['new'] }));
    expect(JSON.parse(localStorage.getItem(cacheKey)).data).toEqual({ sessions: ['new'] });
  });

  it('ignores a cached payload fetched from a different URL', () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: '/api/v1/fitness/sessions?since=30d', version: 'v1', savedAt: 1, data: { sessions: ['old'] } }));
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    expect(result.current).toBeNull();
  });

  it('does not persist sources outside the persist list', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const Wrapper = ({ children }) => (
      <ScreenDataProvider sources={{ weather: { source: '/w' } }} persistKey="fitness:home" persist={['sessions']}>
        {children}
      </ScreenDataProvider>
    );
    const { result } = renderHook(() => useScreenData('weather'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toEqual({ temp: 72 }));
    expect(localStorage.getItem('screenData:fitness:home:weather')).toBeNull();
  });

  it('exposes refetch through actionsRef while mounted and clears it on unmount', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ sessions: [] }) });
    const actionsRef = { current: null };
    const { unmount } = renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper({ actionsRef }) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(typeof actionsRef.current?.refetch).toBe('function');
    await act(() => actionsRef.current.refetch('sessions'));
    expect(mockFetch).toHaveBeenCalledTimes(2);

    unmount();
    expect(actionsRef.current).toBeNull();
  });

  it('ignores a cached payload written by a different build, then rewrites it for this build', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v0', savedAt: 1, data: { sessions: ['old-shape'] } }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: ['new'] }) });

    const { result } = renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ sessions: ['new'] }));
    const entry = JSON.parse(localStorage.getItem(cacheKey));
    expect(entry.version).toBe('v1');
    expect(entry.data).toEqual({ sessions: ['new'] });
  });

  it('keeps exactly one storage entry per source across versions', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v0', savedAt: 1, data: {} }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: [] }) });

    renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    await waitFor(() => expect(JSON.parse(localStorage.getItem(cacheKey)).version).toBe('v1'));
    expect(Object.keys(localStorage).filter((k) => k.startsWith('screenData:'))).toEqual([cacheKey]);
  });
});
