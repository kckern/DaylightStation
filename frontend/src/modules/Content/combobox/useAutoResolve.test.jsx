// useAutoResolve.test.jsx — the row-level freeform auto-resolve hook.
// fetch and timers are fully stubbed; no test touches the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

const notifySuccess = vi.fn();
const showUndoToast = vi.fn();
vi.mock('./notify.js', () => ({
  notifySuccess: (...args) => notifySuccess(...args),
  showUndoToast: (...args) => showUndoToast(...args),
}));

import { useAutoResolve } from './useAutoResolve.js';

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const HIT = { id: 'plex:123', source: 'plex', localId: '123', title: 'Blue Danube' };

let fetchMock;

function setup(initialProps = {}) {
  return renderHook((props) => useAutoResolve(props), {
    initialProps: {
      value: '',
      onChange: vi.fn(),
      setContentInfo: vi.fn(),
      fetchMetadata: vi.fn(() => Promise.resolve(null)),
      ...initialProps,
    },
  });
}

describe('useAutoResolve', () => {
  beforeEach(() => {
    notifySuccess.mockClear();
    showUndoToast.mockClear();
    fetchMock = vi.fn(() => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('non-id-like text triggers a tier-1 take=1 batch fetch', async () => {
    const { result } = setup({ value: 'blue danube' });

    let started;
    act(() => { started = result.current.maybeResolve('blue danube'); });

    expect(started).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/content/query/search?text=blue%20danube&take=1&tier=1');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('id-like text never triggers a resolve', () => {
    const onChange = vi.fn();
    const { result } = setup({ value: 'plex:456', onChange });

    let started;
    act(() => { started = result.current.maybeResolve('plex:456'); });
    expect(started).toBe(false);

    // Legacy spacing (`hymn: 147`) is also id-like.
    act(() => { started = result.current.maybeResolve('hymn: 147'); });
    expect(started).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resolves to the top hit when the committed value is still the freeform text', async () => {
    const onChange = vi.fn();
    const setContentInfo = vi.fn();
    const info = { value: 'plex:123', title: 'Blue Danube', unresolved: false };
    const fetchMetadata = vi.fn(() => Promise.resolve(info));
    fetchMock.mockImplementation(() => jsonResponse({ items: [HIT] }));

    const { result } = setup({ value: 'blue danube', onChange, setContentInfo, fetchMetadata });

    await act(async () => { result.current.maybeResolve('blue danube'); });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith('plex:123', HIT);
    expect(showUndoToast).toHaveBeenCalledTimes(1);
    expect(fetchMetadata).toHaveBeenCalledWith('plex:123');
    await waitFor(() => expect(setContentInfo).toHaveBeenCalledWith('plex:123', info));
  });

  it('auto-resolve is undoable: undo restores the original freeform text', async () => {
    const onChange = vi.fn();
    fetchMock.mockImplementation(() => jsonResponse({ items: [HIT] }));

    const { result } = setup({ value: 'blue danube', onChange });

    await act(async () => { result.current.maybeResolve('blue danube'); });

    // Happy path still fires with the resolved id + item.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('plex:123', HIT));

    // Success path shows an undo toast (not a plain success toast).
    await waitFor(() => expect(showUndoToast).toHaveBeenCalledTimes(1));
    expect(notifySuccess).not.toHaveBeenCalled();

    const arg = showUndoToast.mock.calls[0][0];
    expect(typeof arg.onUndo).toBe('function');

    // Invoking onUndo restores the ORIGINAL freeform text, not the resolved id.
    act(() => { arg.onUndo(); });
    expect(onChange).toHaveBeenLastCalledWith('blue danube');
  });

  it('onChange does NOT fire when the value changed under the in-flight resolve', async () => {
    const onChange = vi.fn();
    let resolveFetch;
    fetchMock.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));

    const { result, rerender } = setup({ value: 'blue danube', onChange });
    act(() => { result.current.maybeResolve('blue danube'); });

    // User manually edits the row before the search returns.
    rerender({
      value: 'plex:999', onChange,
      setContentInfo: vi.fn(), fetchMetadata: vi.fn(() => Promise.resolve(null)),
    });

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ items: [HIT] }) });
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
    expect(showUndoToast).not.toHaveBeenCalled();
  });

  it('aborts the fetch after the 15s timeout', () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));

    const { result } = setup({ value: 'blue danube' });
    act(() => { result.current.maybeResolve('blue danube'); });

    const { signal } = fetchMock.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    act(() => { vi.advanceTimersByTime(15001); });
    expect(signal.aborted).toBe(true);
  });

  it('cancel() aborts an in-flight resolve (edit-restart parity)', () => {
    fetchMock.mockImplementation((url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));

    const { result } = setup({ value: 'blue danube' });
    act(() => { result.current.maybeResolve('blue danube'); });

    const { signal } = fetchMock.mock.calls[0][1];
    act(() => { result.current.cancel(); });
    expect(signal.aborted).toBe(true);
  });

  it('a newer resolve supersedes the previous in-flight one', async () => {
    const onChange = vi.fn();
    const pending = [];
    fetchMock.mockImplementation((url, { signal }) => new Promise((res, rej) => {
      pending.push(res);
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));

    const { result, rerender } = setup({ value: 'first text', onChange });
    act(() => { result.current.maybeResolve('first text'); });
    const firstSignal = fetchMock.mock.calls[0][1].signal;

    rerender({
      value: 'second text', onChange,
      setContentInfo: vi.fn(), fetchMetadata: vi.fn(() => Promise.resolve(null)),
    });
    act(() => { result.current.maybeResolve('second text'); });

    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      pending[1]({ ok: true, status: 200, json: () => Promise.resolve({ items: [HIT] }) });
      await Promise.resolve();
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith('plex:123', HIT);
  });

  it('no results → no onChange, no toast', async () => {
    const onChange = vi.fn();
    fetchMock.mockImplementation(() => jsonResponse({ items: [] }));

    const { result } = setup({ value: 'zzqx nothing', onChange });
    await act(async () => { result.current.maybeResolve('zzqx nothing'); });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
    expect(showUndoToast).not.toHaveBeenCalled();
  });
});
