import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import { useApiResource } from './useApiResource.js';

describe('useApiResource', () => {
  beforeEach(() => apiMock.mockReset());

  it('loads data and clears loading', async () => {
    apiMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(result.current.error).toBeNull();
  });

  it('captures errors', async () => {
    // mockRejectedValueOnce, not mockRejectedValue: a *persistent* rejecting
    // implementation left armed past this test's own await — combined with the
    // beforeEach(mockReset()) above — trips a Vitest 4.1.10 framework quirk
    // that misattributes a phantom "unhandled rejection" to this test, even
    // though the hook's .then/.catch chain demonstrably consumes it (see the
    // "[Logger] api.failed" line the test emits) and Node's own
    // process.on('unhandledRejection') never fires. Once-consumed leaves
    // nothing armed and sidesteps it entirely — see task-4-report.md for the
    // isolated repro that pinned this down.
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error.message).toBe('boom');
  });

  it('null path disables and does not call the API', () => {
    const { result } = renderHook(() => useApiResource(null));
    expect(result.current.loading).toBe(false);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reload refetches', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    apiMock.mockResolvedValue({ n: 2 });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('discards responses that land after unmount', async () => {
    let resolve;
    apiMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useApiResource('api/v1/thing'));
    unmount();
    resolve({ late: true }); // must not throw or warn about state updates
    await new Promise((r) => setTimeout(r, 0));
  });
});
