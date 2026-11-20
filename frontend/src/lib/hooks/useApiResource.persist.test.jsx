import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import {
  registerResourcePersistence, primeApiResource, useApiResource, resetApiResourceCache, peekApiResource,
  flushApiResourcePersistence, isApiResourceFresh, prefetchApiResources,
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
  const registrations = [];
  function register(store, options) {
    const registration = registerResourcePersistence({ store, prefixes: PREFIXES, ...options });
    registrations.push(registration);
    return registration;
  }

  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });
  afterEach(() => { for (const registration of registrations.splice(0)) registration.dispose(); });

  it('a restored path paints on the first render and still revalidates', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/day?date=2026-09-25', value: { v: 'disk' } }] });
    const registration = register(store);
    expect(await registration.ready).toBe(1);
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
    expect(store.put).not.toHaveBeenCalled();
    expect(registration.setOwner('first-user')).toBe(false);
    await act(async () => {
      apiMock.mockResolvedValue({ v: 'confirmed' });
      result.current.reload();
    });
    flushApiResourcePersistence();
    expect(store.records.get('api/v1/health/day?date=2026-09-25')).toEqual({ v: 'confirmed' });
  });

  it('persists only paths under the prefixes, batched', async () => {
    const store = memoryStore({ owner: 'first-user' });
    await register(store, { owner: 'first-user' }).ready;
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
    const unavailable = register(broken);
    expect(await unavailable.ready).toBe(0);
    unavailable.dispose();
    const slow = { ...memoryStore(), load: vi.fn(() => new Promise(() => {})) };
    expect(await register(slow, { timeoutMs: 10 }).ready).toBe(0);
    apiMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/health/context', { swr: true }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
  });

  it('a different owner drops what came from disk and refetches it', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/day?date=2026-09-25', value: { who: 'first-user' } }] });
    const registration = register(store);
    await registration.ready;
    const network = deferred();
    apiMock.mockReturnValueOnce(network.promise).mockResolvedValue({ who: 'second-user' });
    const { result } = renderHook(() => useApiResource('api/v1/health/day?date=2026-09-25', { swr: true }));
    expect(result.current.data).toEqual({ who: 'first-user' });
    act(() => { expect(registration.setOwner('second-user')).toBe(true); });
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

  it('releases both a superseded prefetch and the foreground GET on owner change', async () => {
    const path = 'api/v1/health/prefetch-takeover';
    const background = deferred();
    const foreground = deferred();
    const fresh = deferred();
    const onDone = vi.fn();
    const registration = register(memoryStore({ owner: 'alice' }), { owner: 'alice' });
    await registration.ready;
    apiMock.mockReturnValueOnce(background.promise)
      .mockReturnValueOnce(foreground.promise).mockReturnValueOnce(fresh.promise);
    prefetchApiResources([path], { onDone });
    const reader = renderHook(() => useApiResource(path, { swr: true }));
    act(() => reader.result.current.reload());
    await act(async () => {});
    expect(apiMock.mock.calls.map(call => call[3]?.signal.aborted)).toEqual([false, false]);

    await act(async () => { registration.setOwner('bob'); });
    expect(apiMock.mock.calls.map(call => call[3]?.signal.aborted)).toEqual([true, true, false]);
    await act(async () => { foreground.resolve('old foreground'); background.resolve('old prefetch'); });
    expect(reader.result.current.data).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => { fresh.resolve('new owner'); });
    expect(reader.result.current.data).toBe('new owner');
  });

  it('the same owner, or a first claim, drops nothing', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: [1] }] });
    const registration = register(store);
    await registration.ready;
    expect(registration.setOwner('first-user')).toBe(false);
    expect(peekApiResource('api/v1/health/weight')).toEqual([1]);
    registration.dispose();
    expect(peekApiResource('api/v1/health/weight')).toBeUndefined();
    const fresh = memoryStore();
    const firstVisit = register(fresh);
    await firstVisit.ready;
    expect(firstVisit.setOwner('first-user')).toBe(false);
    expect(fresh.owner).toBe('first-user');
  });

  it('refetches mounted readers when a different registration takes over the same path', async () => {
    const path = 'api/v1/health/day';
    const old = deferred();
    const next = memoryStore({ owner: 'bob' });
    const previous = register(memoryStore({ owner: 'amy' }));
    await previous.ready;
    apiMock.mockReturnValueOnce(old.promise).mockResolvedValue({ owner: 'bob' });
    const { result } = renderHook(() => useApiResource(path, { swr: true }));
    await act(async () => {
      previous.dispose();
      await register(next, { owner: 'bob' }).ready;
    });
    await act(async () => old.resolve({ owner: 'amy' }));
    await waitFor(() => expect(result.current.data).toEqual({ owner: 'bob' }));
    flushApiResourcePersistence();
    expect(next.records.get(path)).toEqual({ owner: 'bob' });
  });

  it('continues a mounted read after detaching persistence', async () => {
    const path = 'api/v1/health/day';
    const pending = deferred();
    const registration = register(memoryStore());
    await registration.ready;
    apiMock.mockReturnValueOnce(pending.promise).mockResolvedValue({ current: true });
    const { result } = renderHook(() => useApiResource(path, { swr: true }));
    act(() => registration.dispose());
    await act(async () => pending.resolve({ current: false }));
    expect(result.current.data).toEqual({ current: true });
    expect(result.current.loading).toBe(false);
  });

  it('does not let a fresh reader join a request from a detached registration', async () => {
    const path = 'api/v1/health/weight';
    const pending = deferred();
    const registration = register(memoryStore());
    await registration.ready;
    apiMock.mockReturnValueOnce(pending.promise).mockResolvedValue({ current: true });
    const old = renderHook(() => useApiResource(path));
    old.unmount();
    registration.dispose();
    const next = renderHook(() => useApiResource(path));
    await act(async () => pending.resolve({ current: false }));
    expect(next.result.current.data).toEqual({ current: true });
  });

  it('an owner that could not be read is never taken for a first visit', async () => {
    // The disk is slow this time: nothing restored, owner unknown.
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: ['first-user'] }] });
    store.load = vi.fn(() => new Promise(() => {}));
    const registration = register(store, { timeoutMs: 10 });
    await registration.ready;
    registration.setOwner('second-user');
    // first-user's snapshots must not be relabelled as second-user's.
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(store.owner).toBe('second-user');
  });

  it('with more on disk than memory holds, the NEWEST entries survive the restore', async () => {
    // load() returns newest first, as the IndexedDB store does.
    const entries = Array.from({ length: 101 }, (_, i) => ({ path: `api/v1/health/day?date=n${String(i).padStart(3, '0')}`, value: i }));
    await register(memoryStore({ owner: 'first-user', entries })).ready;
    expect(peekApiResource('api/v1/health/day?date=n000')).toBe(0);
    expect(peekApiResource('api/v1/health/day?date=n100')).toBeUndefined();
  });

  it('resetting a path deletes it from disk too', async () => {
    const store = memoryStore({ owner: 'first-user', entries: [{ path: 'api/v1/health/weight', value: [1] }] });
    await register(store, { owner: 'first-user' }).ready;
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

  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('cancels the shared GET after the last reader leaves (cached: %s, %s)', async (firstCached, secondCached) => {
    const retired = deferred();
    apiMock.mockReturnValueOnce(retired.promise).mockResolvedValueOnce({ visit: 'new' });
    const path = '/api/v1/shared-retired-read';
    const first = renderHook(() => useApiResource(path, { swr: firstCached }));
    const second = renderHook(() => useApiResource(path, { swr: secondCached }));
    expect(apiMock).toHaveBeenCalledTimes(1);
    const signal = apiMock.mock.calls[0][3]?.signal;

    first.unmount();
    await act(async () => {});
    expect(signal?.aborted).toBe(false);
    second.unmount();
    await act(async () => {});
    expect(signal?.aborted).toBe(true);

    const next = renderHook(() => useApiResource(path, { swr: firstCached }));
    await waitFor(() => expect(next.result.current.data).toEqual({ visit: 'new' }));
    await act(async () => { retired.resolve({ visit: 'old' }); });
    expect(next.result.current.data).toEqual({ visit: 'new' });
    expect(apiMock).toHaveBeenCalledTimes(2);
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
    const signal = apiMock.mock.calls[0][3]?.signal;
    await act(async () => {});
    expect(signal?.aborted).toBe(false);
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


it('isolates live registrations and rejects a previous owner response after switching', async () => {
  const a = registerResourcePersistence({ store: memoryStore(), prefixes: ['scoped/a/'] });
  const b = registerResourcePersistence({ store: memoryStore(), prefixes: ['scoped/b/'] });
  try {
    await Promise.all([a.ready, b.ready]);
    a.setOwner('alice');
    b.setOwner('bob');
    expect(() => registerResourcePersistence({ store: memoryStore(), prefixes: ['scoped/a/day'] })).toThrow(/overlap/i);
    primeApiResource('scoped/b/list', { keep: true });
    const old = deferred();
    apiMock.mockReset().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ owner: 'carol' });
    const reader = renderHook(() => useApiResource('scoped/a/list', { swr: true }));
    act(() => a.setOwner('carol'));
    await waitFor(() => expect(reader.result.current.data).toEqual({ owner: 'carol' }));
    await act(async () => old.resolve({ owner: 'alice' }));
    expect(peekApiResource('scoped/a/list')).toEqual({ owner: 'carol' });
    reader.unmount();
    a.dispose();
    expect(peekApiResource('scoped/b/list')).toEqual({ keep: true });
  } finally {
    a.dispose();
    b.dispose();
  }
});

it('ignores unowned disk records and retires reads and writes issued before the first owner claim', async () => {
  const path = 'first-claim/day';
  const otherPath = 'first-claim/weight';
  const store = memoryStore({ entries: [{ path, value: 'unowned disk entry' }] });
  const handle = registerResourcePersistence({ store, prefixes: ['first-claim/'] });
  const old = deferred();
  const current = deferred();
  try {
    expect(await handle.ready).toBe(0);
    expect(peekApiResource(path)).toBeUndefined();
    apiMock.mockReset().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const reader = renderHook(() => useApiResource(path, { swr: true }));
    primeApiResource(otherPath, 'unowned memory entry');
    flushApiResourcePersistence();
    expect(store.put).not.toHaveBeenCalled();

    act(() => handle.setOwner('bob'));
    expect(reader.result.current.data).toBeNull();
    expect(peekApiResource(otherPath)).toBeUndefined();
    await act(async () => { old.resolve('unowned network result'); });
    expect(reader.result.current.data).toBeNull();
    await act(async () => { current.resolve('current owner result'); });
    expect(reader.result.current.data).toBe('current owner result');
    flushApiResourcePersistence();
    expect(store.put.mock.calls).toEqual([[path, 'current owner result', expect.any(Number), 'bob']]);
  } finally {
    handle.dispose();
  }
});

it('retires an unscoped prefetch when a registration attaches and disposes before it completes', async () => {
  const path = 'takeover/day';
  const old = deferred();
  const onDone = vi.fn();
  apiMock.mockReset().mockReturnValueOnce(old.promise);
  prefetchApiResources([path], { onDone });
  const handle = registerResourcePersistence({ store: memoryStore({ owner: 'alice' }), prefixes: ['takeover/'] });
  await handle.ready;
  handle.dispose();
  await act(async () => { old.resolve('old unscoped result'); });
  expect(peekApiResource(path)).toBeUndefined();
  expect(onDone).not.toHaveBeenCalled();
});

it('isolates out-of-order hydration, queued writes and disposal while the sibling reader stays mounted', async () => {
  const pathA = 'parallel/a/list';
  const pathB = 'parallel/b/list';
  const hydration = deferred();
  const oldRead = deferred();
  const newRead = deferred();
  const siblingRead = deferred();
  const nextSiblingRead = deferred();
  const storeA = memoryStore({ owner: 'alice' });
  const storeB = memoryStore({ owner: 'bob', entries: [{ path: pathB, value: 'disk B' }] });
  storeA.load.mockReturnValueOnce(hydration.promise);
  const a = registerResourcePersistence({ store: storeA, prefixes: ['parallel/a/'] });
  const b = registerResourcePersistence({ store: storeB, prefixes: ['parallel/b/'] });
  apiMock.mockReset().mockImplementation(path => path === pathA ? oldRead.promise : siblingRead.promise);
  const readers = [];
  try {
    expect(await b.ready).toBe(1);
    b.setOwner('bob');
    const readerB = renderHook(() => useApiResource(pathB, { swr: true }));
    readers.push(readerB);
    expect(readerB.result.current.data).toBe('disk B');
    hydration.resolve({ owner: 'alice', entries: [{ path: pathA, value: 'disk A' }, { path: pathB, value: 'wrong store' }] });
    expect(await a.ready).toBe(1);
    expect(peekApiResource(pathB)).toBe('disk B');
    const readerA = renderHook(() => useApiResource(pathA, { swr: true }));
    readers.push(readerA);
    expect(readerA.result.current.data).toBe('disk A');

    primeApiResource(pathA, 'queued Alice write');
    apiMock.mockImplementation(path => path === pathA ? newRead.promise : nextSiblingRead.promise);
    act(() => a.setOwner('carol'));
    expect(readerA.result.current.data).toBeNull();
    await act(async () => oldRead.resolve('late Alice read'));
    expect(readerA.result.current.data).toBeNull();
    await act(async () => {
      newRead.resolve('Carol');
      siblingRead.resolve('Bob');
    });
    flushApiResourcePersistence();
    expect(storeA.put.mock.calls).toEqual([[pathA, 'Carol', expect.any(Number), 'carol']]);
    expect(storeB.put.mock.calls).toEqual([[pathB, 'Bob', expect.any(Number), 'bob']]);

    readerA.unmount();
    a.dispose();
    act(() => readerB.result.current.reload());
    await act(async () => nextSiblingRead.resolve('Bob after disposal'));
    flushApiResourcePersistence();
    expect(readerB.result.current.data).toBe('Bob after disposal');
    expect(storeB.records.get(pathB)).toBe('Bob after disposal');
    expect(storeA.put).toHaveBeenCalledTimes(1);
  } finally {
    for (const reader of readers) reader.unmount();
    a.dispose();
    b.dispose();
  }
});
