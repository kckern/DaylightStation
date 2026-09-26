import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import { useApiResource, resetApiResourceCache, TRANSIENT_RETRY_DELAYS_MS } from './useApiResource.js';

// A proxy 502 while the backend restarts (api.mjs marks it `transient`) is
// expected to clear in seconds: the hook asks again before reporting it.
const transient = (status = 502) => Object.assign(new Error(`HTTP ${status}: Bad Gateway`), { status, transient: true });
const waitOut = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useApiResource transient retry', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('a 502 followed by a success shows the data and no error', async () => {
    apiMock.mockRejectedValueOnce(transient()).mockResolvedValueOnce({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing', { swr: true }));
    await waitOut(TRANSIENT_RETRY_DELAYS_MS[0]);
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(result.current.error).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('reports the failure once every retry has also failed', async () => {
    apiMock.mockRejectedValue(transient(503));
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    for (const delay of TRANSIENT_RETRY_DELAYS_MS) await waitOut(delay);
    await waitFor(() => expect(result.current.error?.status).toBe(503));
    expect(result.current.loading).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(TRANSIENT_RETRY_DELAYS_MS.length + 1);
  });

  it('does not retry a failure that will not change (a 404)', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('HTTP 404: Not Found'), { status: 404, transient: false }));
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(result.current.error?.status).toBe(404));
    await waitOut(TRANSIENT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the reader unmounts', async () => {
    apiMock.mockRejectedValue(transient());
    const { unmount } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    unmount();
    await waitOut(TRANSIENT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
