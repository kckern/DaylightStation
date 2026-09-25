import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import {
  useApiResource, resetApiResourceCache, peekApiResource, attachApiResourcePersistence,
  detachApiResourcePersistence, claimApiResourceOwner, flushApiResourcePersistence, isApiResourceFresh, prefetchApiResources,
} from './useApiResource.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// The store contract persistentResourceStore.js implements, in memory.
function memoryStore({ owner = null, entries = [] } = {}) {
  const records = new Map(entries.map(e => [e.path, e.value]));
  const store = {
    owner,
    records,
    ops: [],
    load: vi.fn(async () => ({ owner: store.owner, entries: [...records].map(([path, value]) => ({ path, value })) })),
    put: vi.fn((path, value) => { store.ops.push(['put', path]); records.set(path, value); }),
    remove: vi.fn(path => { store.ops.push(['remove', path]); records.delete(path); }),
    clear: vi.fn(() => { store.ops.push(['clear']); records.clear(); }),
    setOwner: vi.fn(next => { store.owner = next; }),
  };
  return store;
}

const PREFIXES = ['api/v1/health/'];

describe('useApiResource persistence', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); detachApiResourcePersistence(); });
  afterEach(() => detachApiResourcePersistence());

  it('a restored path paints on the first render and still revalidates', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/day?date=2026-09-25', value: { v: 'disk' } }] });
    expect(await attachApiResourcePersistence({ store, prefixes: PREFIXES })).toBe(1);
    const network = deferred();
    apiMock.mockReturnValueOnce(network.promise);
    const { result } = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-25', { swr: true }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ v: 'disk' });
    expect(result.current.revalidating).toBe(true);
    // Restored is stale by definition: the prefetcher must not skip it.
    expect(isApiResourceFresh('api/v1/health/day?date=2026-09-25')).toBe(false);
    await act(async () => { network.resolve({ v: 'network' }); });
    await waitFor(() => expect(result.current.data).toEqual({ v: 'network' }));
    flushApiResourcePersistence();
    expect(store.records.get('api/v1/health/day?date=2026-09-25')).toEqual({ v: 'network' });
  });

  it('persists only paths under the prefixes, batched', async () => {
    const store = memoryStore();
    await attachApiResourcePersistence({ store, prefixes: PREFIXES });
    apiMock.mockImplementation(async path => ({ path }));
    renderHook(() => useApiResource('api/v1/health/weight', { swr: true }));
    renderHook(() => useApiResource('api/v1/fitness/sessions', { swr: true }));
    await waitFor(() => expect(peekApiResource('api/v1/fitness/sessions')).toBeTruthy());
    await waitFor(() => expect(peekApiResource('api/v1/health/weight')).toBeTruthy());
    expect(store.put).not.toHaveBeenCalled(); // batched, not per write
    flushApiResourcePersistence();
    expect([...store.records.keys()]).toEqual(['api/v1/health/weight']);
  });

  it('an unavailable or slow store restores nothing and the page loads normally', async () => {
    const broken = { ...memoryStore(), load: vi.fn(async () => null) };
    expect(await attachApiResourcePersistence({ store: broken, prefixes: PREFIXES })).toBe(0);
    const slow = { ...memoryStore(), load: vi.fn(() => new Promise(() => {})) };
    expect(await attachApiResourcePersistence({ store: slow, prefixes: PREFIXES, timeoutMs: 10 })).toBe(0);
    apiMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/health/context', { swr: true }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
  });

  it('a different owner drops what came from disk and refetches it', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/day?date=2026-09-25', value: { who: 'first-user' } }] });
    await attachApiResourcePersistence({ store, prefixes: PREFIXES });
    const network = deferred();
    apiMock.mockReturnValueOnce(network.promise).mockResolvedValue({ who: 'second-user' });
    const { result } = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-25', { swr: true }));
    expect(result.current.data).toEqual({ who: 'first-user' });
    act(() => { expect(claimApiResourceOwner('second-user')).toBe(true); });
    // Off the screen at once, not just out of the cache.
    expect(result.current.data).toBeNull();
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(store.owner).toBe('second-user');
    expect(peekApiResource('api/v1/health/day?date=2026-09-25')).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ who: 'second-user' }));
    // The pre-claim request (issued for the old owner) never lands afterwards.
    await act(async () => { network.resolve({ who: 'first-user' }); });
    expect(result.current.data).toEqual({ who: 'second-user' });
  });

  it('the same owner, or a first claim, drops nothing', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: [1] }] });
    await attachApiResourcePersistence({ store, prefixes: PREFIXES });
    expect(claimApiResourceOwner('first-user')).toBe(false);
    expect(peekApiResource('api/v1/health/weight')).toEqual([1]);
    detachApiResourcePersistence();
    resetApiResourceCache();
    const fresh = memoryStore();
    await attachApiResourcePersistence({ store: fresh, prefixes: PREFIXES });
    expect(claimApiResourceOwner('first-user')).toBe(false);
    expect(fresh.clear).not.toHaveBeenCalled();
    expect(fresh.owner).toBe('first-user');
  });

  it('an owner that could not be read is never taken for a first visit', async () => {
    // The disk is slow this time: nothing restored, owner unknown.
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: ['first-user'] }] });
    store.load = vi.fn(() => new Promise(() => {}));
    await attachApiResourcePersistence({ store, prefixes: PREFIXES, timeoutMs: 10 });
    claimApiResourceOwner('second-user');
    // first-user's snapshots must not be relabelled as second-user's.
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(store.owner).toBe('second-user');
  });

  it('with more on disk than memory holds, the NEWEST entries survive the restore', async () => {
    // load() returns newest first, as the IndexedDB store does.
    const entries = Array.from({ length: 101 }, (_, i) => ({ path: `api/v1/health/day?date=n${String(i).padStart(3, '0')}`, value: i }));
    await attachApiResourcePersistence({ store: memoryStore({ owner: 'first-user', entries }), prefixes: PREFIXES });
    expect(peekApiResource('api/v1/health/day?date=n000')).toBe(0);
    expect(peekApiResource('api/v1/health/day?date=n100')).toBeUndefined();
  });

  it('resetting a path deletes it from disk too', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: [1] }] });
    await attachApiResourcePersistence({ store, prefixes: PREFIXES });
    resetApiResourceCache('api/v1/health/weight');
    flushApiResourcePersistence();
    expect(store.records.has('api/v1/health/weight')).toBe(false);
  });
});

describe('useApiResource in-flight dedupe', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('two readers mounting together share one request', async () => {
    const network = deferred();
    apiMock.mockReturnValueOnce(network.promise);
    const a = renderHook(() => useApiResource('api/v1/health/weight', { swr: true }));
    const b = renderHook(() => useApiResource('api/v1/health/weight'));
    expect(apiMock).toHaveBeenCalledTimes(1);
    await act(async () => { network.resolve([172]); });
    await waitFor(() => expect(a.result.current.data).toEqual([172]));
    await waitFor(() => expect(b.result.current.data).toEqual([172]));
  });

  it('a reload after a write never joins the request issued before it', async () => {
    const before = deferred();
    apiMock.mockReturnValueOnce(before.promise).mockResolvedValueOnce({ v: 'after-write' });
    const { result } = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-25', { swr: true }));
    act(() => result.current.reload());
    expect(apiMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toEqual({ v: 'after-write' }));
    await act(async () => { before.resolve({ v: 'before-write' }); });
    expect(result.current.data).toEqual({ v: 'after-write' });
    expect(peekApiResource('api/v1/health/day?date=2026-09-25')).toEqual({ v: 'after-write' });
  });

  it('a prefetch joins a request whose reader went away, and still caches the answer', async () => {
    const network = deferred();
    apiMock.mockReturnValueOnce(network.promise);
    const reader = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-24', { swr: true }));
    reader.unmount(); // the user flipped to the next day mid-flight
    prefetchApiResources(['api/v1/health/day?date=2026-09-24']);
    expect(apiMock).toHaveBeenCalledTimes(1);
    await act(async () => { network.resolve({ day: 24 }); });
    expect(peekApiResource('api/v1/health/day?date=2026-09-24')).toEqual({ day: 24 });
  });

  it('a request pending past the join window is not joined: a later mount fetches afresh', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    apiMock.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({ fresh: true });
    const stuck = renderHook(() => useApiResource('api/v1/home/cameras'));
    stuck.unmount();
    now.mockReturnValue(start + 3001);
    const later = renderHook(() => useApiResource('api/v1/home/cameras'));
    await waitFor(() => expect(later.result.current.data).toEqual({ fresh: true }));
    expect(apiMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('a finished request is not reused: the next mount fetches again', async () => {
    apiMock.mockResolvedValueOnce({ n: 1 }).mockResolvedValueOnce({ n: 2 });
    const a = renderHook(() => useApiResource('x'));
    await waitFor(() => expect(a.result.current.data).toEqual({ n: 1 }));
    const b = renderHook(() => useApiResource('x'));
    await waitFor(() => expect(b.result.current.data).toEqual({ n: 2 }));
  });
});
