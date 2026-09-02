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
    apiMock.mockRejectedValue(new Error('boom'));
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
