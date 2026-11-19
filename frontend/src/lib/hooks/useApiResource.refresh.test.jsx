import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

import { registerResourcePersistence, resetApiResourceCache, useApiResource } from './useApiResource.js';

describe('useApiResource.refresh', () => {
  beforeEach(() => {
    api.mockReset();
    resetApiResourceCache();
  });

  it('keeps a dedupe opt-out separate without replacing a shared in-flight read', async () => {
    const sharedRead = Promise.withResolvers();
    const independentRead = Promise.withResolvers();
    api.mockReturnValueOnce(sharedRead.promise).mockReturnValueOnce(independentRead.promise);

    const first = renderHook(() => useApiResource('/records', { retryTransient: false }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const independent = renderHook(() => useApiResource('/records', { dedupe: false, retryTransient: false }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const second = renderHook(() => useApiResource('/records', { retryTransient: false }));

    await act(async () => { independentRead.resolve({ value: 'independent' }); });
    expect(independent.result.current.data).toEqual({ value: 'independent' });
    expect(first.result.current.data).toBeNull();
    expect(second.result.current.data).toBeNull();

    await act(async () => { sharedRead.resolve({ value: 'shared' }); });
    expect(first.result.current.data).toEqual({ value: 'shared' });
    expect(second.result.current.data).toEqual({ value: 'shared' });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh read, returns its accepted snapshot, and ignores an older response', async () => {
    let resolveMount;
    let resolveRefresh;
    api.mockImplementationOnce(() => new Promise(resolve => { resolveMount = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const { result } = renderHook(() => useApiResource('/records', { retryTransient: false }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    await act(async () => { resolveRefresh({ version: 2 }); });
    await expect(refreshed).resolves.toEqual({ version: 2 });
    expect(result.current.data).toEqual({ version: 2 });

    await act(async () => { resolveMount({ version: 1 }); });
    expect(result.current.data).toEqual({ version: 2 });
  });

  it('rejects with the read error and keeps the resource error visible', async () => {
    const readError = new Error('read failed');
    api.mockResolvedValueOnce({ value: 'initial' }).mockRejectedValueOnce(readError);
    const { result } = renderHook(() => useApiResource('/records', { retryTransient: false }));
    await waitFor(() => expect(result.current.data).toEqual({ value: 'initial' }));

    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await act(async () => { await expect(refreshed).rejects.toBe(readError); });
    expect(result.current.error).toBe(readError);
  });

  it('rejects a pending refresh with AbortError when its key changes', async () => {
    let resolveRefresh;
    let aReads = 0;
    api.mockImplementation(path => {
      if (path === '/a' && ++aReads === 2) return new Promise(resolve => { resolveRefresh = resolve; });
      return Promise.resolve({ path });
    });
    const { result, rerender } = renderHook(({ path }) => useApiResource(path, { retryTransient: false }), {
      initialProps: { path: '/a' },
    });
    await waitFor(() => expect(result.current.data).toEqual({ path: '/a' }));

    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    rerender({ path: '/b' });
    await act(async () => { await expect(refreshed).rejects.toMatchObject({ name: 'AbortError' }); });
    await waitFor(() => expect(result.current.data).toEqual({ path: '/b' }));
    await act(async () => { resolveRefresh({ path: '/a', stale: true }); });
    expect(result.current.data).toEqual({ path: '/b' });
  });

  it('rejects a pending refresh with AbortError when the reader unmounts', async () => {
    let resolveRefresh;
    api.mockResolvedValueOnce({ value: 'initial' }).mockImplementationOnce(
      () => new Promise(resolve => { resolveRefresh = resolve; }),
    );
    const { result, unmount } = renderHook(() => useApiResource('/records', { retryTransient: false }));
    await waitFor(() => expect(result.current.data).toEqual({ value: 'initial' }));

    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    unmount();
    await expect(refreshed).rejects.toMatchObject({ name: 'AbortError' });
    resolveRefresh({ value: 'late' });
  });

  it('settles both callers when one refresh supersedes another in the same render batch', async () => {
    api.mockResolvedValueOnce({ value: 'initial' }).mockResolvedValueOnce({ value: 'fresh' });
    const { result } = renderHook(() => useApiResource('/records', { retryTransient: false }));
    await waitFor(() => expect(result.current.data).toEqual({ value: 'initial' }));

    let superseded;
    let refreshed;
    act(() => {
      superseded = result.current.refresh();
      refreshed = result.current.refresh();
    });
    await act(async () => {
      await expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
      await expect(refreshed).resolves.toEqual({ value: 'fresh' });
    });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('rejects a pending refresh on owner change without publishing its old snapshot', async () => {
    const registration = registerResourcePersistence({
      prefixes: ['/records'],
      store: {
        load: async () => ({ owner: 'first', entries: [] }),
        claimOwner: vi.fn(),
      },
    });
    let unmountReader;
    try {
      await registration.ready;
      let finishOldRead;
      api.mockResolvedValueOnce({ owner: 'first' })
        .mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }))
        .mockResolvedValueOnce({ owner: 'second' });
      const { result, unmount } = renderHook(() => useApiResource('/records', { retryTransient: false }));
      unmountReader = unmount;
      await waitFor(() => expect(result.current.data).toEqual({ owner: 'first' }));

      let refreshed;
      act(() => { refreshed = result.current.refresh(); });
      act(() => { registration.setOwner('second'); });
      await act(async () => { await expect(refreshed).rejects.toMatchObject({ name: 'AbortError' }); });
      await waitFor(() => expect(result.current.data).toEqual({ owner: 'second' }));
      await act(async () => { finishOldRead({ owner: 'first', stale: true }); });
      expect(result.current.data).toEqual({ owner: 'second' });
    } finally {
      unmountReader?.();
      registration.dispose();
    }
  });
});
