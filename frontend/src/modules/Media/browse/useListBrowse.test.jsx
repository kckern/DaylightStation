import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useListBrowse } from './useListBrowse.js';

beforeEach(() => { apiMock.mockReset(); });

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
});
