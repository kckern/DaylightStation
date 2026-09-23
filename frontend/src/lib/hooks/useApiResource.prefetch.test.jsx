import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import {
  useApiResource, resetApiResourceCache, prefetchApiResources, isApiResourceFresh,
  peekApiResource, invalidateApiResources, getPrefetchStats,
} from './useApiResource.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(r => setTimeout(r, 0));

describe('prefetchApiResources', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('a prefetched path paints instantly when a reader mounts on it', async () => {
    apiMock.mockResolvedValue({ day: 'd-1' });
    prefetchApiResources(['api/v1/health/day?date=2026-09-20']);
    await flush();
    expect(peekApiResource('api/v1/health/day?date=2026-09-20')).toEqual({ day: 'd-1' });
    const { result } = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-20', { swr: true }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ day: 'd-1' });
    await waitFor(() => expect(result.current.revalidating).toBe(false));
  });

  it('counts queued / completed / failed, and reports once when the queue drains', async () => {
    apiMock.mockImplementation(async path => { if (path === 'bad') throw new Error('nope'); return {}; });
    const onIdle = vi.fn();
    expect(prefetchApiResources(['a', 'bad', 'c'], { onIdle })).toBe(3);
    await flush(); await flush();
    expect(getPrefetchStats()).toEqual({ queued: 3, completed: 2, failed: 1 });
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith({ queued: 3, completed: 2, failed: 1 });
    resetApiResourceCache();
    expect(getPrefetchStats()).toEqual({ queued: 0, completed: 0, failed: 0 });
  });

  it('runs at most two requests at once, in queue order', async () => {
    const calls = [];
    apiMock.mockImplementation(path => { const d = deferred(); calls.push({ path, d }); return d.promise; });
    prefetchApiResources(['a', 'b', 'c']);
    expect(calls.map(c => c.path)).toEqual(['a', 'b']);
    calls[0].d.resolve({});
    await flush();
    expect(calls.map(c => c.path)).toEqual(['a', 'b', 'c']);
  });

  it('a new call replaces what is still queued; in-flight requests finish', async () => {
    const calls = [];
    apiMock.mockImplementation(path => { const d = deferred(); calls.push({ path, d }); return d.promise; });
    prefetchApiResources(['a', 'b', 'c', 'd']);
    prefetchApiResources(['x']);
    calls[0].d.resolve({}); calls[1].d.resolve({});
    await flush();
    expect(calls.map(c => c.path)).toEqual(['a', 'b', 'x']);
  });

  it('skips fresh paths, and refetches them after an invalidation', async () => {
    apiMock.mockResolvedValue({ v: 1 });
    prefetchApiResources(['p']);
    await flush();
    expect(isApiResourceFresh('p')).toBe(true);
    expect(prefetchApiResources(['p'])).toBe(0);
    invalidateApiResources(path => path === 'p');
    expect(isApiResourceFresh('p')).toBe(false);
    expect(peekApiResource('p')).toEqual({ v: 1 }); // stale still paints
    expect(prefetchApiResources(['p'])).toBe(1);
  });

  it('never overwrites a newer reader response', async () => {
    const slow = deferred();
    apiMock.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ v: 'reader' });
    prefetchApiResources(['q']);
    const { result } = renderHook(() => useApiResource('q', { swr: true }));
    await waitFor(() => expect(result.current.data).toEqual({ v: 'reader' }));
    slow.resolve({ v: 'prefetch' });
    await flush();
    expect(peekApiResource('q')).toEqual({ v: 'reader' });
  });

  it('a failed prefetch leaves the cache alone and reports to onDone', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    const onDone = vi.fn();
    prefetchApiResources(['r'], { onDone });
    await flush();
    expect(peekApiResource('r')).toBeUndefined();
    expect(onDone).toHaveBeenCalledWith(expect.any(Error), 'r');
  });

  it('does not request a path again while its prefetch is in flight', async () => {
    const calls = [];
    apiMock.mockImplementation(path => { const d = deferred(); calls.push({ path, d }); return d.promise; });
    prefetchApiResources(['a']);
    prefetchApiResources(['a', 'b']);
    expect(calls.map(c => c.path)).toEqual(['a', 'b']);
  });

  it('a key change to a cached path paints that path in the first render, with no empty frame', async () => {
    apiMock.mockImplementation(async path => ({ path }));
    prefetchApiResources(['day?d=2']);
    await flush();
    const seen = [];
    const { result, rerender } = renderHook(({ p }) => {
      const r = useApiResource(p, { swr: true });
      seen.push({ p, data: r.data, loading: r.loading });
      return r;
    }, { initialProps: { p: 'day?d=1' } });
    await waitFor(() => expect(result.current.data).toEqual({ path: 'day?d=1' }));
    seen.length = 0;
    rerender({ p: 'day?d=2' });
    expect(seen[0]).toEqual({ p: 'day?d=2', data: { path: 'day?d=2' }, loading: false });
    expect(seen.every(s => s.data !== null && !s.loading)).toBe(true);
  });
});
