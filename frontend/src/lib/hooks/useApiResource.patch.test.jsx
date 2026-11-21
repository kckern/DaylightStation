import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import { useApiResource, resetApiResourceCache, patchApiResource, peekApiResource } from './useApiResource.js';

// patchApiResource: a write that already knows its committed result shows it
// on the mounted reader at once, instead of waiting for a refetch that can sit
// behind every other request the page has in flight.
describe('patchApiResource', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
  });

  it('a mounted swr reader shows the patched value before any refetch lands', async () => {
    apiMock.mockResolvedValue({ items: ['a'] });
    const { result } = renderHook(() => useApiResource('api/v1/day', { swr: true }));
    await waitFor(() => expect(result.current.data).toEqual({ items: ['a'] }));

    apiMock.mockReturnValue(new Promise(() => {})); // the revalidation never lands
    act(() => { patchApiResource('api/v1/day', day => ({ items: [...day.items, 'b'] })); });
    expect(result.current.data).toEqual({ items: ['a', 'b'] });
    expect(peekApiResource('api/v1/day')).toEqual({ items: ['a', 'b'] });
  });

  it('revalidates after patching, so the server copy replaces the patch', async () => {
    apiMock.mockResolvedValue({ items: ['a'] });
    const { result } = renderHook(() => useApiResource('api/v1/day', { swr: true }));
    await waitFor(() => expect(result.current.data).toEqual({ items: ['a'] }));

    apiMock.mockResolvedValue({ items: ['a', 'b'], revision: 2 });
    act(() => { patchApiResource('api/v1/day', day => ({ items: [...day.items, 'b'] })); });
    await waitFor(() => expect(result.current.data).toEqual({ items: ['a', 'b'], revision: 2 }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('a request issued before the patch cannot put the old value back', async () => {
    apiMock.mockResolvedValue({ items: ['a'] });
    const { result } = renderHook(() => useApiResource('api/v1/day', { swr: true }));
    await waitFor(() => expect(result.current.data).toEqual({ items: ['a'] }));

    // A background poll is in flight with the pre-write day...
    let resolveStale;
    apiMock.mockReturnValueOnce(new Promise(r => { resolveStale = r; }));
    act(() => { result.current.reload(); });
    // ...the write lands and patches; the patch's own revalidation hangs.
    apiMock.mockReturnValue(new Promise(() => {}));
    act(() => { patchApiResource('api/v1/day', day => ({ items: [...day.items, 'b'] })); });

    await act(async () => { resolveStale({ items: ['a'] }); await Promise.resolve(); });
    expect(result.current.data).toEqual({ items: ['a', 'b'] });
    expect(peekApiResource('api/v1/day')).toEqual({ items: ['a', 'b'] });
  });

  it('shares one post-patch read and excludes a request issued before the patch', async () => {
    const path = 'api/v1/day';
    let resolveBefore;
    let resolveAfter;
    apiMock
      .mockResolvedValueOnce({ items: ['a'] })
      .mockReturnValueOnce(new Promise(resolve => { resolveBefore = resolve; }))
      .mockReturnValue(new Promise(resolve => { resolveAfter = resolve; }));
    const first = renderHook(() => useApiResource(path, { swr: true }));
    await waitFor(() => expect(first.result.current.data).toEqual({ items: ['a'] }));
    const second = renderHook(() => useApiResource(path, { swr: true }));
    expect(apiMock).toHaveBeenCalledTimes(2);

    act(() => { patchApiResource(path, day => ({ items: [...day.items, 'b'] })); });
    expect(first.result.current.data).toEqual({ items: ['a', 'b'] });
    expect(second.result.current.data).toEqual({ items: ['a', 'b'] });
    expect(apiMock).toHaveBeenCalledTimes(3);
    await act(async () => { resolveBefore({ items: ['a'] }); });
    expect(first.result.current.data).toEqual({ items: ['a', 'b'] });
    expect(second.result.current.data).toEqual({ items: ['a', 'b'] });
    const snapshot = { items: ['a', 'b'], revision: 2 };
    await act(async () => { resolveAfter(snapshot); });
    expect(first.result.current.data).toBe(snapshot);
    expect(second.result.current.data).toBe(snapshot);
    expect(peekApiResource(path)).toBe(snapshot);
  });

  it('does nothing for a path nothing has loaded yet', () => {
    expect(patchApiResource('api/v1/never', () => ({ x: 1 }))).toBe(false);
    expect(peekApiResource('api/v1/never')).toBeUndefined();
  });
});
