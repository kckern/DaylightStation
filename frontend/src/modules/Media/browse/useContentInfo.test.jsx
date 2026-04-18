import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useContentInfo } from './useContentInfo.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useContentInfo', () => {
  it('fetches /api/v1/info/:source/:localId and exposes info', async () => {
    apiMock.mockResolvedValueOnce({ title: 'The Lonesome Kicker', duration: 355 });
    const { result } = renderHook(() => useContentInfo('plex:587484'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/plex/587484');
    expect(result.current.info?.title).toBe('The Lonesome Kicker');
    expect(result.current.error).toBeNull();
  });

  it('preserves slashes in localId', async () => {
    apiMock.mockResolvedValueOnce({});
    renderHook(() => useContentInfo('hymn-library:198/second'));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/hymn-library/198/second');
  });

  it('no-op for null/invalid contentId', async () => {
    const { result } = renderHook(() => useContentInfo(null));
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.info).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('captures error', async () => {
    apiMock.mockRejectedValueOnce(new Error('not found'));
    const { result } = renderHook(() => useContentInfo('plex:bad'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('not found');
  });
});
