import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePanelFetch, allUnavailable } from "./usePanelFetch.js";

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

  it('hands the fetcher a signal that aborts when its answer would be thrown away', async () => {
    const signals = [];
    const fetcher = (args) => { signals.push(args.signal); return new Promise(() => {}); };
    const { rerender, unmount } = renderHook(({ id }) => usePanelFetch(fetcher, { panel: 'x', deps: [id] }), {
      initialProps: { id: 'one' },
    });
    expect(signals[0].aborted).toBe(false);
    rerender({ id: 'two' });
    expect(signals[0].aborted).toBe(true);
    unmount();
    expect(signals[1].aborted).toBe(true);
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

describe('stale-while-revalidate retry', () => {
  it('keeps good data through a retry and through a failed refresh', async () => {
    const { renderHook, waitFor: hookWaitFor, act: hookAct } = await import('@testing-library/react');
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, data: { items: [1] } };
      return { ok: false, status: 500, data: null };
    });
    const { result } = renderHook(() => usePanelFetch(fetcher, { panel: 'swr-test' }));
    await hookWaitFor(() => expect(result.current.state).toBe('ok'));
    hookAct(() => result.current.retry());
    // During the refresh the old data stays up.
    expect(result.current.data).toEqual({ items: [1] });
    await hookWaitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    // The failed refresh keeps the stale data — no blank error panel.
    await hookWaitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.state).toBe('ok');
    expect(result.current.data).toEqual({ items: [1] });
  });

  it('a first-load failure still errors (nothing stale to show)', async () => {
    const { renderHook, waitFor: hookWaitFor } = await import('@testing-library/react');
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, data: null }));
    const { result } = renderHook(() => usePanelFetch(fetcher, { panel: 'swr-test' }));
    await hookWaitFor(() => expect(result.current.state).toBe('error'));
  });
});

describe('resource metadata and query changes', () => {
  it('keeps the verification time and failure status when a useful read goes stale', async () => {
    let calls = 0;
    const fetcher = async () => ++calls === 1
      ? { ok: true, status: 200, data: ['verified'] }
      : { ok: false, status: 503, data: null };
    const { result } = renderHook(() => usePanelFetch(fetcher, { panel: 'metadata' }));
    await waitFor(() => expect(result.current.state).toBe('ok'));
    const verified = result.current.lastSuccessAt;
    expect(verified).toEqual(expect.any(Number));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.data).toEqual(['verified']);
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toMatchObject({ status: 503 });
    expect(result.current.lastSuccessAt).toBe(verified);
  });

  it('does not show the previous learner data or accept its late response after a key changes', async () => {
    const resolvers = {};
    const { result, rerender } = renderHook(({ learner }) => usePanelFetch(
      () => new Promise(resolve => { resolvers[learner] = resolve; }), { panel: 'identity', deps: [learner] },
    ), { initialProps: { learner: 'first' } });
    rerender({ learner: 'second' });
    await act(async () => resolvers.first({ ok: true, status: 200, data: ['first'] }));
    expect(result.current.data).toBeNull();
    await act(async () => resolvers.second({ ok: true, status: 200, data: ['second'] }));
    expect(result.current.data).toEqual(['second']);
  });
});

it('repairs a mounted teacher read when an external correction arrives', async () => {
  const { wsService } = await import('../../../../../frontend/src/services/WebSocketService.js');
  let receive;
  const stopMessages = vi.fn(); const stopStatus = vi.fn();
  const messages = vi.spyOn(wsService, 'subscribe').mockImplementation((_topics, callback) => { receive = callback; return stopMessages; });
  const statuses = vi.spyOn(wsService, 'onStatusChange').mockImplementation(callback => { callback({ connected: true }); return stopStatus; });
  let revision = 0;
  const { result, unmount } = renderHook(() => usePanelFetch(async () => ({ ok: true, status: 200, data: { revision: ++revision } }), { panel: 'live-teacher' }));
  try {
    await waitFor(() => expect(result.current.data).toEqual({ revision: 1 }));
    expect(receive).toEqual(expect.any(Function));
    act(() => receive({ topic: 'school', event: 'record-changed', learnerId: 'kid' }));
    await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }));
    unmount();
    expect(stopMessages).toHaveBeenCalledOnce(); expect(stopStatus).toHaveBeenCalledOnce();
  } finally { unmount(); messages.mockRestore(); statuses.mockRestore(); }
});
