import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createSchoolResourceStore } from './schoolResources.js';
import { useSchoolResource } from './useSchoolResource.js';

const ok = data => ({ ok: true, status: 200, data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('School resources', () => {
  it('rejects older concurrent reads without replacing a newer payload or verification time', async () => {
    const store = createSchoolResourceStore();
    const first = deferred(); const second = deferred();
    const older = store.read(['surface', 'kid', 'day'], () => first.promise);
    const newer = store.read(['surface', 'kid', 'day'], () => second.promise, { fresh: true });
    second.resolve(ok({ revision: 2 })); await newer;
    const verified = store.getSnapshot(['surface', 'kid', 'day']).lastSuccessAt;
    first.resolve(ok({ revision: 1 })); await older;
    expect(store.getSnapshot(['surface', 'kid', 'day'])).toMatchObject({ state: 'ready', data: { revision: 2 }, lastSuccessAt: verified, stale: false });
  });

  it('shares concurrent reads, then preserves stale data, status and verification time on failure', async () => {
    const store = createSchoolResourceStore(); const request = deferred();
    const load = vi.fn(() => request.promise);
    const a = store.read(['a', 'kid'], load); const b = store.read(['a', 'kid'], load);
    expect(load).toHaveBeenCalledTimes(1);
    request.resolve(ok(['verified'])); await Promise.all([a, b]);
    const verified = store.getSnapshot(['a', 'kid']).lastSuccessAt;
    await store.read(['a', 'kid'], async () => ({ ok: false, status: 503, data: null }), { fresh: true });
    expect(store.getSnapshot(['a', 'kid'])).toMatchObject({ state: 'ready', data: ['verified'], stale: true, refreshing: false, error: { status: 503 }, lastSuccessAt: verified });
  });

  it('settles synchronous throws and rejected refreshes with safe error metadata', async () => {
    const store = createSchoolResourceStore();
    await store.read('throws', () => { throw new Error('private learner text'); });
    expect(store.getSnapshot('throws')).toMatchObject({ state: 'error', refreshing: false, error: { kind: 'exception', status: 0 } });
    expect(JSON.stringify(store.getSnapshot('throws'))).not.toContain('private');
  });

  it('invalidates only matching identities and refreshes mounted consumers', async () => {
    const store = createSchoolResourceStore(); let revision = 0;
    const a = renderHook(() => useSchoolResource({ store, key: ['screen-a', 'kid'], load: async () => ok([++revision]) }));
    const b = renderHook(() => useSchoolResource({ store, key: ['screen-b', 'kid'], load: async () => ok(['other']) }));
    await waitFor(() => expect(a.result.current.state).toBe('ready'));
    await waitFor(() => expect(b.result.current.state).toBe('ready'));
    act(() => store.invalidate(['screen-a']));
    await waitFor(() => expect(a.result.current.data).toEqual([2]));
    expect(b.result.current.data).toEqual(['other']);
    expect(b.result.current.stale).toBe(false);
  });

  it('uses private hook lifetimes, clears old identity immediately, and aborts discarded work', async () => {
    const pending = {};
    const { result, rerender, unmount } = renderHook(({ kid }) => useSchoolResource({
      key: ['surface', kid, 'query'], load: ({ signal }) => {
        const request = deferred(); pending[kid] = { ...request, signal }; return request.promise;
      },
    }), { initialProps: { kid: 'a' } });
    await act(async () => pending.a.resolve(ok(['a'])));
    rerender({ kid: 'b' });
    expect(result.current.data).toBeNull();
    expect(result.current.lastSuccessAt).toBeNull();
    unmount();
    expect(pending.b.signal.aborted).toBe(true);
  });

  it('keeps a shared load alive until its final consumer leaves', async () => {
    const store = createSchoolResourceStore(); let signal;
    const load = ({ signal: value }) => { signal = value; return new Promise(() => {}); };
    const a = renderHook(() => useSchoolResource({ store, key: ['shared'], load }));
    const b = renderHook(() => useSchoolResource({ store, key: ['shared'], load }));
    a.unmount(); expect(signal.aborted).toBe(false);
    b.unmount(); expect(signal.aborted).toBe(true);
  });

  it('maps empty, null, unavailable and disabled without granting ready status', async () => {
    const empty = renderHook(() => useSchoolResource({ key: 'empty', load: async () => ok([]) }));
    const unavailable = renderHook(() => useSchoolResource({ key: 'missing', load: async () => ({ ok: false, status: 404, data: null }), notFoundAs: 'unavailable' }));
    const load = vi.fn();
    const disabled = renderHook(() => useSchoolResource({ key: 'disabled', load, enabled: false }));
    await waitFor(() => expect(empty.result.current.state).toBe('empty'));
    await waitFor(() => expect(unavailable.result.current.state).toBe('unavailable'));
    expect(disabled.result.current.data).toBeNull(); expect(load).not.toHaveBeenCalled();
  });
});

describe('bounded surface resource retention', () => {
  it('evicts least recently used inactive entries while retaining subscribed and in-flight reads', async () => {
    const store = createSchoolResourceStore({ maxEntries: 2 });
    await store.read('a', async () => ok(['a']));
    await store.read('b', async () => ok(['b']));
    store.getSnapshot('a'); // a was most recently used, so b is the inactive victim.
    await store.read('c', async () => ok(['c']));
    expect(store.size).toBe(2);
    expect(store.getSnapshot('a').data).toEqual(['a']);
    expect(store.getSnapshot('b').data).toBeNull();

    const pending = deferred();
    const unsubscribe = store.subscribe('mounted', () => {});
    const reading = store.read('inflight', () => pending.promise);
    await store.read('other', async () => ok(['other']));
    expect(store.getSnapshot('mounted').state).toBe('loading');
    pending.resolve(ok(['kept'])); await reading;
    expect(store.getSnapshot('inflight').data).toEqual(['kept']);
    unsubscribe();
    expect(store.size).toBeLessThanOrEqual(2);
  });
});
