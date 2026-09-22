import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useListBrowse } from './useListBrowse.js';

beforeEach(() => { apiMock.mockReset(); });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useListBrowse', () => {
  it('fetches on mount with take param and exposes items', async () => {
    apiMock.mockResolvedValueOnce({ items: [{ id: 'a' }, { id: 'b' }], total: 10 });
    const { result } = renderHook(() => useListBrowse('watchlist/TVApp', { take: 25 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/list/watchlist/TVApp?take=25');
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(10);
  });

  it('applies modifiers (playable + shuffle) as path segments', async () => {
    apiMock.mockResolvedValueOnce({ items: [], total: 0 });
    renderHook(() => useListBrowse('music/recent', { modifiers: { playable: true, shuffle: true }, take: 5 }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/list/music/recent/playable/shuffle?take=5');
  });

  it('loadMore appends the next page with skip', async () => {
    apiMock
      .mockResolvedValueOnce({ items: [{ id: '1' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: '2' }], total: 2 });
    const { result } = renderHook(() => useListBrowse('x', { take: 1 }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.loadMore(); });
    expect(apiMock).toHaveBeenLastCalledWith('api/v1/list/x?take=1&skip=1');
    expect(result.current.items).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('captures error and sets loading=false', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useListBrowse('x'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.items).toEqual([]);
  });

  it('does not append an old path page after navigation', async () => {
    const oldPageTwo = deferred();
    const newPageOne = deferred();
    apiMock.mockImplementation((url) => {
      if (url === 'api/v1/list/old?take=1') return Promise.resolve({ items: [{ id: 'old-1' }], total: 2 });
      if (url === 'api/v1/list/old?take=1&skip=1') return oldPageTwo.promise;
      if (url === 'api/v1/list/new?take=1') return newPageOne.promise;
      throw new Error(`Unexpected URL: ${url}`);
    });
    const { result, rerender } = renderHook(
      ({ path }) => useListBrowse(path, { take: 1 }),
      { initialProps: { path: 'old' } },
    );
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'old-1' }]));
    let oldLoad;
    act(() => { oldLoad = result.current.loadMore(); });
    rerender({ path: 'new' });
    await act(async () => { newPageOne.resolve({ items: [{ id: 'new-1' }], total: 1 }); });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'new-1' }]));

    await act(async () => { oldPageTwo.resolve({ items: [{ id: 'old-2' }], total: 2 }); await oldLoad; });
    expect(result.current.items).toEqual([{ id: 'new-1' }]);
  });

  it('ignores a queued old observer callback until the new path first page owns its skip', async () => {
    const newPageOne = deferred();
    apiMock.mockImplementation((url) => {
      if (url === 'api/v1/list/old?take=1') return Promise.resolve({ items: [{ id: 'old-1' }], total: 2 });
      if (url === 'api/v1/list/new?take=1') return newPageOne.promise;
      if (url === 'api/v1/list/new?take=1&skip=0') return Promise.resolve({ items: [{ id: 'new-1' }], total: 1 });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const { result, rerender } = renderHook(
      ({ path }) => useListBrowse(path, { take: 1 }),
      { initialProps: { path: 'old' } },
    );
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'old-1' }]));
    const queuedObserverLoad = result.current.loadMore;

    rerender({ path: 'new' });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/list/new?take=1'));
    await act(async () => { await queuedObserverLoad(); });
    expect(apiMock).not.toHaveBeenCalledWith('api/v1/list/new?take=1&skip=0');
    expect(apiMock).toHaveBeenCalledTimes(2);

    await act(async () => { newPageOne.resolve({ items: [{ id: 'new-1' }], total: 1 }); });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'new-1' }]));
  });
});
