import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePanelFetch, allUnavailable } from './usePanelFetch.js';

const ok = (data) => async () => ({ ok: true, status: 200, data });
const fail = (status) => async () => ({ ok: false, status, data: null });

describe('usePanelFetch', () => {
  it('resolves ok with data', async () => {
    const { result } = renderHook(() => usePanelFetch(ok([{ id: 1 }]), { panel: 'x' }));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('an empty payload is empty, not ok', async () => {
    const { result } = renderHook(() => usePanelFetch(ok([]), { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('404 maps per the panel: unavailable for lifecycle panels', async () => {
    const { result } = renderHook(() => usePanelFetch(fail(404), { panel: 'x', notFoundAs: 'unavailable' }));
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
  });

  it('404 maps per the panel: empty for known 404-as-empty reads', async () => {
    const { result } = renderHook(() => usePanelFetch(fail(404), { panel: 'x', notFoundAs: 'empty' }));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('404 defaults to error when unmapped', async () => {
    const { result } = renderHook(() => usePanelFetch(fail(404), { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('an ok null maps via nullAs (report-card unwired tell)', async () => {
    const { result } = renderHook(() => usePanelFetch(ok(null), { panel: 'x', nullAs: 'unavailable' }));
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
  });

  it('an ok null defaults to empty', async () => {
    const { result } = renderHook(() => usePanelFetch(ok(null), { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('a 500 is an error', async () => {
    const { result } = renderHook(() => usePanelFetch(fail(500), { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('retry refetches', async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 500, data: null } : { ok: true, status: 200, data: ['fine'] };
    };
    const { result } = renderHook(() => usePanelFetch(flaky, { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.data).toEqual(['fine']);
  });

  it('a custom isEmpty drives the empty state', async () => {
    const { result } = renderHook(() => usePanelFetch(ok({ sessions: [] }), {
      panel: 'x', isEmpty: (d) => !d.sessions.length,
    }));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('refetches when deps change', async () => {
    const fetcher = vi.fn(ok(['a']));
    const { result, rerender } = renderHook(({ id }) => usePanelFetch(() => fetcher(id), { panel: 'x', deps: [id] }), {
      initialProps: { id: 'one' },
    });
    await waitFor(() => expect(result.current.state).toBe('ok'));
    rerender({ id: 'two' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});

describe('allUnavailable', () => {
  it('true only when every state is unavailable', () => {
    expect(allUnavailable(['unavailable', 'unavailable'])).toBe(true);
    expect(allUnavailable(['unavailable', 'ok'])).toBe(false);
    expect(allUnavailable([])).toBe(false);
  });
});

describe('usePanelFetch rejection path', () => {
  it('a throwing fetcher lands in error, never loading-forever', async () => {
    const { result } = renderHook(() => usePanelFetch(async () => { throw new Error('boom'); }, { panel: 'x' }));
    await waitFor(() => expect(result.current.state).toBe('error'));
  });
});
