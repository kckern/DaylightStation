import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { useHouseholdActions, useFavourites, useScreenNamer } from './useHousehold.js';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

function wrapperWith(outcomes) {
  return ({ children }) => <DispatchContext.Provider value={outcomes}>{children}</DispatchContext.Provider>;
}

let outcomes;
beforeEach(() => {
  apiMock.mockReset();
  resetApiResourceCache();
  outcomes = { recordLocal: vi.fn(() => 'attempt-1'), resolveLocal: vi.fn() };
});

describe('useHouseholdActions', () => {
  it('removes from the household list in one step, with Undo = DELETE /household/removed', async () => {
    apiMock.mockResolvedValue({ id: 'plex:1', removedAt: 'x' });
    const { result } = renderHook(() => useHouseholdActions(), { wrapper: wrapperWith(outcomes) });
    await act(() => result.current.removeFromList({ id: 'plex:1', title: 'Late film' }));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/removed', { id: 'plex:1' }, 'POST');
    const record = outcomes.recordLocal.mock.calls[0][0];
    expect(record).toMatchObject({ kind: 'hide', phase: 'running', item: { contentId: 'plex:1', title: 'Late film' } });
    expect(record.undo.expiresAt - Date.now()).toBeGreaterThan(9000);
    expect(outcomes.resolveLocal).toHaveBeenCalledWith('attempt-1', { phase: 'confirmed' });
    apiMock.mockResolvedValue({ id: 'plex:1', restored: true });
    await expect(record.undo.run()).resolves.toEqual({ ok: true });
    expect(apiMock).toHaveBeenLastCalledWith('api/v1/media/household/removed?id=plex%3A1', {}, 'DELETE');
  });

  it('reports a failed removal through the outcome system, never a toast', async () => {
    apiMock.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderHook(() => useHouseholdActions(), { wrapper: wrapperWith(outcomes) });
    await act(() => result.current.removeFromList({ id: 'plex:1', title: 'X' }));
    expect(outcomes.resolveLocal).toHaveBeenCalledWith('attempt-1', { phase: 'failed', reason: 'HTTP 500' });
  });

  it('toggles a favourite in one step, both ways', async () => {
    apiMock.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useHouseholdActions(), { wrapper: wrapperWith(outcomes) });
    await act(() => result.current.toggleFavourite({ id: 'plex:9', title: 'Bluey', itemType: 'container', type: 'show' }, false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/favourites',
      { id: 'plex:9', kind: 'collection', title: 'Bluey', type: 'show' }, 'POST');
    expect(outcomes.recordLocal.mock.calls[0][0].kind).toBe('favourite');
    await act(() => result.current.toggleFavourite({ id: 'plex:9', title: 'Bluey' }, true));
    expect(apiMock).toHaveBeenLastCalledWith('api/v1/media/household/favourites?id=plex%3A9', {}, 'DELETE');
    expect(outcomes.recordLocal.mock.calls[1][0].kind).toBe('unfavourite');
  });

  it('marks watched and unwatched', async () => {
    apiMock.mockResolvedValue({ watched: true });
    const { result } = renderHook(() => useHouseholdActions(), { wrapper: wrapperWith(outcomes) });
    await act(() => result.current.markWatched({ id: 'plex:5', title: 'Film' }, true));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/watched', { contentId: 'plex:5', watched: true }, 'POST');
    expect(outcomes.recordLocal.mock.calls[0][0].kind).toBe('watched');
    await act(() => result.current.markWatched({ id: 'plex:5', title: 'Film' }, false));
    expect(outcomes.recordLocal.mock.calls[1][0].kind).toBe('unwatched');
  });
});

describe('read hooks', () => {
  it('exposes favourites as a set of ids', async () => {
    apiMock.mockResolvedValue({ items: [{ id: 'plex:1' }, { id: 'plex:2' }] });
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(result.current.has('plex:2')).toBe(true));
    expect(result.current.has('plex:3')).toBe(false);
  });

  it('names screens from the registry', async () => {
    apiMock.mockResolvedValue({ screens: [{ id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV' }] });
    const { result } = renderHook(() => useScreenNamer());
    await waitFor(() => expect(result.current('fleet:livingroom-tv')).toBe('Living Room TV'));
  });
});
