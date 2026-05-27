import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHubConfig } from './useHubConfig.js';

describe('useHubConfig', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns loading=true with no config until fetch resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => {/* never */}));
    const { result } = renderHook(() => useHubConfig());
    expect(result.current.loading).toBe(true);
    expect(result.current.config).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('populates config on successful GET', async () => {
    const fakeConfig = {
      devices: [{ color: 'red', position: 1 }],
      scheduled: [],
    };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, config: fakeConfig }),
      })
    );

    const { result } = renderHook(() => useHubConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toEqual(fakeConfig);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/playback-hub/config');
  });

  it('sets error on HTTP 500 response', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ ok: false, error: 'datastore failed' }),
      })
    );

    const { result } = renderHook(() => useHubConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toBeNull();
    expect(result.current.error).toBe('datastore failed');
  });

  it('falls back to HTTP status when body has no error message', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.resolve({}),
      })
    );

    const { result } = renderHook(() => useHubConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('HTTP 502');
    expect(result.current.config).toBeNull();
  });

  it('sets error when fetch throws (network failure)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    const { result } = renderHook(() => useHubConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toBeNull();
    expect(result.current.error).toBe('network down');
  });

  it('revalidate re-fetches and updates config', async () => {
    let call = 0;
    global.fetch = vi.fn(() => {
      call += 1;
      const config = { devices: [{ color: 'red', position: call }] };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, config }),
      });
    });

    const { result } = renderHook(() => useHubConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config.devices[0].position).toBe(1);

    await act(async () => {
      await result.current.revalidate();
    });

    expect(result.current.config.devices[0].position).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('revalidate sets loading=true mid-flight', async () => {
    let resolveFirst;
    let resolveSecond;
    global.fetch = vi
      .fn()
      .mockImplementationOnce(() => new Promise((res) => {
        resolveFirst = () => res({
          ok: true, status: 200,
          json: () => Promise.resolve({ ok: true, config: { v: 1 } }),
        });
      }))
      .mockImplementationOnce(() => new Promise((res) => {
        resolveSecond = () => res({
          ok: true, status: 200,
          json: () => Promise.resolve({ ok: true, config: { v: 2 } }),
        });
      }));

    const { result } = renderHook(() => useHubConfig());

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFirst();
      // Wait for setState to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.config).toEqual({ v: 1 });
    });

    // Trigger revalidate but don't resolve yet.
    let revalidatePromise;
    act(() => {
      revalidatePromise = result.current.revalidate();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      resolveSecond();
      await revalidatePromise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.config).toEqual({ v: 2 });
  });
});
