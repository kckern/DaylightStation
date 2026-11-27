import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useContentInfo } from "./useContentInfo.js";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

describe('useContentInfo', () => {
  it('fetches /api/v1/info/:source/:localId and exposes info', async () => {
    apiMock.mockResolvedValueOnce({ title: 'The Lonesome Kicker', duration: 355 });
    const { result } = renderHook(() => useContentInfo('plex:587484'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/plex/587484', {}, 'GET', { signal: expect.any(AbortSignal) });
    expect(result.current.info?.title).toBe('The Lonesome Kicker');
    expect(result.current.error).toBeNull();
  });

  it('preserves slashes in localId', async () => {
    apiMock.mockResolvedValueOnce({});
    renderHook(() => useContentInfo('hymn-library:198/second'));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/hymn-library/198/second', {}, 'GET', { signal: expect.any(AbortSignal) });
  });

  it('no-op for null/invalid contentId', async () => {
    const { result } = renderHook(() => useContentInfo(null));
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.info).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('conceals the previous item on the very first render for a new key and ignores its late refresh', async () => {
    let finishOld;
    let finishNew;
    apiMock.mockResolvedValueOnce({ title: 'A' })
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const renders = [];
    const { result, rerender } = renderHook(({ id }) => {
      const state = useContentInfo(id);
      renders.push({ id, info: state.info, loading: state.loading });
      return state;
    }, { initialProps: { id: 'plex:a' } });

    await waitFor(() => expect(result.current.info?.title).toBe('A'));
    act(() => result.current.reload());
    await waitFor(() => expect(finishOld).toBeTypeOf('function'));
    rerender({ id: 'plex:b' });
    expect(renders.find(row => row.id === 'plex:b')).toEqual({ id: 'plex:b', info: null, loading: true });
    await waitFor(() => expect(finishNew).toBeTypeOf('function'));
    await act(async () => finishNew({ title: 'B' }));
    await act(async () => finishOld({ title: 'stale A' }));
    expect(result.current.info?.title).toBe('B');
  });

  it('lets the same detail recover from an error on reload', async () => {
    apiMock.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ title: 'Recovered' });
    const { result } = renderHook(() => useContentInfo('plex:retry'));
    await waitFor(() => expect(result.current.error?.message).toBe('Unavailable'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.info?.title).toBe('Recovered'));
    expect(result.current.error).toBeNull();
  });

  it('captures error', async () => {
    apiMock.mockRejectedValueOnce(new Error('not found'));
    const { result } = renderHook(() => useContentInfo('plex:bad'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('not found');
  });
});
