import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import { useApiResource, resetApiResourceCache } from './useApiResource.js';

// The swr cache is module-level (shared across every hook instance in the
// process), so tests MUST reset it between cases or an earlier test's cached
// payload leaks into a later test's "cold" mount. resetApiResourceCache()
// (exported for exactly this purpose) clears the whole cache; the same
// function accepts a path to invalidate a single entry, which is the seam a
// later task (mutation -> invalidate the day view's cache) can use.
describe('useApiResource swr mode', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
  });

  it('cold mount with swr behaves like a normal load: loading true -> data, and populates the cache', async () => {
    apiMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(result.current.error).toBeNull();
  });

  it('second mount of the same path: loading is false and data is the cached value immediately, revalidating flips while the background fetch runs, then data updates', async () => {
    apiMock.mockResolvedValue({ ok: 1 });
    const first = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    let resolveSecond;
    apiMock.mockReturnValue(new Promise((r) => { resolveSecond = r; }));

    const second = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    // Immediately on first render — no waitFor — cached data + loading:false.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toEqual({ ok: 1 });
    expect(second.result.current.revalidating).toBe(true);

    await act(async () => { resolveSecond({ ok: 2 }); await Promise.resolve(); });
    await waitFor(() => expect(second.result.current.data).toEqual({ ok: 2 }));
    expect(second.result.current.revalidating).toBe(false);
    expect(second.result.current.loading).toBe(false);
  });

  it('reload() with cached data present revalidates quietly: loading never flips to true', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 });

    let resolveReload;
    apiMock.mockReturnValue(new Promise((r) => { resolveReload = r; }));
    act(() => { result.current.reload(); });
    // Synchronously after the reload-triggering act() flushes the effect:
    // never observed true.
    expect(result.current.loading).toBe(false);
    expect(result.current.revalidating).toBe(true);

    await act(async () => { resolveReload({ n: 2 }); await Promise.resolve(); });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.loading).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('failed revalidation with cache present keeps the stale data and reports the error', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 });

    apiMock.mockRejectedValueOnce(new Error('offline'));
    act(() => { result.current.reload(); });
    expect(result.current.loading).toBe(false); // revalidation, not a cold load
    await waitFor(() => expect(result.current.revalidating).toBe(false));

    // Chosen behavior: stale data stays visible (a food log on a flaky
    // connection should keep showing the last-known values), but the error
    // is still surfaced so the caller can render a "couldn't refresh" cue.
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error.message).toBe('offline');
  });

  it('a cold (no cache) fetch failure still clears loading and reports the error with no data', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error.message).toBe('boom');
  });

  it('cache isolation: a different path is unaffected by another path\'s cached entry', async () => {
    apiMock.mockResolvedValue({ from: 'a' });
    const a = renderHook(() => useApiResource('api/v1/a', { swr: true }));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();

    apiMock.mockResolvedValue({ from: 'b' });
    const b = renderHook(() => useApiResource('api/v1/b', { swr: true }));
    // Cold mount for the new path: no cache hit, loading starts true.
    expect(b.result.current.loading).toBe(true);
    expect(b.result.current.data).toBeNull();
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.data).toEqual({ from: 'b' });
  });

  // THE REGRESSION PIN — the shared hook's other 21 call sites depend on this.
  // A consumer that does not pass `swr` must observe exactly today's
  // behavior: loading starts true (never reads the cache), and a second
  // mount of the same path still starts with loading:true, even though an
  // swr-enabled consumer already warmed that same path's cache entry above.
  it('regression pin: without swr, behavior is byte-identical to before — no cache is ever consulted', async () => {
    apiMock.mockResolvedValue({ ok: 1 });
    // Warm the module cache for this exact path via an swr-enabled hook first.
    const warmer = renderHook(() => useApiResource('api/v1/plain', { swr: true }));
    await waitFor(() => expect(warmer.result.current.loading).toBe(false));
    warmer.unmount();
    expect(apiMock).toHaveBeenCalledTimes(1);

    // First mount, no swr: must NOT see the cached data, must start loading.
    apiMock.mockResolvedValue({ ok: 2 });
    const first = renderHook(() => useApiResource('api/v1/plain'));
    expect(first.result.current.loading).toBe(true);
    expect(first.result.current.data).toBeNull();
    expect(first.result.current.revalidating).toBe(false);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.data).toEqual({ ok: 2 });
    first.unmount();

    // Second mount, no swr, same path: STILL starts with loading:true and
    // null data — a non-swr consumer never gets served a cached value.
    apiMock.mockResolvedValue({ ok: 3 });
    const second = renderHook(() => useApiResource('api/v1/plain'));
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.data).toBeNull();
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.data).toEqual({ ok: 3 });

    // reload() on a non-swr consumer flips loading true, as before.
    apiMock.mockResolvedValue({ ok: 4 });
    act(() => { second.result.current.reload(); });
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(second.result.current.data).toEqual({ ok: 4 }));
  });

  it('resetApiResourceCache(path) invalidates only that entry', async () => {
    apiMock.mockResolvedValue({ v: 1 });
    const a = renderHook(() => useApiResource('api/v1/x', { swr: true }));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();
    const b = renderHook(() => useApiResource('api/v1/y', { swr: true }));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    b.unmount();

    resetApiResourceCache('api/v1/x');

    apiMock.mockResolvedValue({ v: 'fresh-x' });
    const a2 = renderHook(() => useApiResource('api/v1/x', { swr: true }));
    expect(a2.result.current.loading).toBe(true); // invalidated -> cold
    a2.unmount();

    apiMock.mockResolvedValue({ v: 'fresh-y' });
    const b2 = renderHook(() => useApiResource('api/v1/y', { swr: true }));
    expect(b2.result.current.loading).toBe(false); // still cached
    expect(b2.result.current.data).toEqual({ v: 1 });
  });

  // Cache-write ordering — reviewer-found bug, fixed by gating the cache
  // write on the same `live` flag that already guards the state writes.
  it('two overlapping reloads: an older response that resolves LAST does not clobber the cache with a stale value', async () => {
    apiMock.mockResolvedValueOnce({ n: 1 });
    const first = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    let resolveOld;
    let resolveNew;
    apiMock.mockReturnValueOnce(new Promise((r) => { resolveOld = r; }));
    act(() => { first.result.current.reload(); }); // older reload, issued first
    apiMock.mockReturnValueOnce(new Promise((r) => { resolveNew = r; }));
    act(() => { first.result.current.reload(); }); // newer reload, issued second

    // Resolve the NEWER one first.
    await act(async () => { resolveNew({ n: 3 }); await Promise.resolve(); });
    await waitFor(() => expect(first.result.current.data).toEqual({ n: 3 }));

    // Now let the OLDER, slower request resolve late.
    await act(async () => { resolveOld({ n: 2 }); await Promise.resolve(); });
    // On-screen data must still be the newer value (already guarded by `live`).
    expect(first.result.current.data).toEqual({ n: 3 });

    first.unmount();

    // A cache hit always kicks off its own background revalidation too —
    // give it something harmless to resolve to so it doesn't crash on an
    // exhausted mock queue; the assertion only cares about the synchronous
    // value served from cache.
    apiMock.mockResolvedValue({ n: 3 });

    // The real assertion: a FRESH mount on the same path must be served the
    // newer cached value, not the stale one the late response would have
    // written without the fix.
    const fresh = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    expect(fresh.result.current.data).toEqual({ n: 3 });
    expect(fresh.result.current.loading).toBe(false);
    await act(async () => { await Promise.resolve(); });
    fresh.unmount();
  });

  it('unmount mid-flight: the in-flight response is not written to the cache', async () => {
    apiMock.mockResolvedValueOnce({ n: 1 });
    const first = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // A second mount of the same path serves the cache immediately, and
    // also kicks off its own background revalidation — which we control here
    // and then abandon by unmounting before it resolves.
    let resolveLate;
    apiMock.mockReturnValueOnce(new Promise((r) => { resolveLate = r; }));
    const second = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    expect(second.result.current.data).toEqual({ n: 1 });
    second.unmount(); // unmounts WHILE the revalidation fetch is still pending

    await act(async () => { resolveLate({ n: 999 }); await Promise.resolve(); });

    // A third, fresh mount must still see the last-known-good cached value —
    // the abandoned in-flight response must not have written to the cache.
    // (Its own revalidation fetch is given a harmless resolved value too.)
    apiMock.mockResolvedValue({ n: 1 });
    const third = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    expect(third.result.current.data).toEqual({ n: 1 });
    await act(async () => { await Promise.resolve(); });
    third.unmount();
  });

  it('path change mid-flight: a late response for the abandoned path does not write into the new path\'s cache entry, nor resurrect its own', async () => {
    let resolveA;
    apiMock.mockReturnValueOnce(new Promise((r) => { resolveA = r; }));
    const { result, rerender, unmount } = renderHook(
      ({ p }) => useApiResource(p, { swr: true }),
      { initialProps: { p: 'api/v1/a' } },
    );
    expect(result.current.loading).toBe(true); // cold mount on A, fetch in flight

    apiMock.mockResolvedValueOnce({ from: 'b' });
    rerender({ p: 'api/v1/b' }); // abandons A mid-flight, mounts cold on B
    await waitFor(() => expect(result.current.data).toEqual({ from: 'b' }));

    // Now let A's late response resolve.
    await act(async () => { resolveA({ from: 'a-late' }); await Promise.resolve(); });
    unmount();

    // B's cache entry must be untouched by A's late response. (B's own
    // background revalidation, triggered by this fresh mount, gets a
    // harmless matching value.)
    apiMock.mockResolvedValue({ from: 'b' });
    const freshB = renderHook(() => useApiResource('api/v1/b', { swr: true }));
    expect(freshB.result.current.data).toEqual({ from: 'b' });
    expect(freshB.result.current.loading).toBe(false);
    await act(async () => { await Promise.resolve(); });
    freshB.unmount();

    // Decision: A's own cache entry is NOT resurrected either. The consumer
    // never rendered A's data (it moved on to B before A resolved), so a
    // late response for a path this hook has abandoned should not silently
    // populate the cache for some future, unrelated mount of A — that would
    // be caching a value nobody ever validated was still wanted. This is a
    // cold mount (no cache), so it issues its own real fetch too.
    apiMock.mockResolvedValueOnce({ from: 'a-fresh' });
    const freshA = renderHook(() => useApiResource('api/v1/a', { swr: true }));
    expect(freshA.result.current.loading).toBe(true); // cold: A was never cached
    expect(freshA.result.current.data).toBeNull();
    await act(async () => { await Promise.resolve(); });
    freshA.unmount();
  });
});
