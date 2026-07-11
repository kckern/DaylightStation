import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let store = {}; // simulated server blob
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path, data = {}, method = 'GET') => {
    calls.push({ path, data, method });
    if (method === 'GET' && Object.keys(data).length === 0) return { ...store };
    // PUT: shallow-merge (mirrors the backend)
    store = { ...store, ...data };
    return { ...store };
  }),
}));

let mockUser = 'user_1';
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: mockUser }),
}));

const applyBundle = vi.fn();
vi.mock('./usePianoSoundBundle.js', () => ({
  usePianoSoundBundle: () => ({ applyBundle, currentBundle: {} }),
}));

import { usePianoPreset } from './usePianoPreset.js';

beforeEach(() => {
  calls.length = 0;
  store = {};
  mockUser = 'user_1';
  applyBundle.mockClear();
});

const bundleA = { voice: { pc: 0, bank: 0 }, reverb: null, chorus: null, volume: 0.6 };
const bundleB = { voice: { pc: 4, bank: 0 }, reverb: { type: 2, level: 40, on: true }, chorus: null, volume: 0.5 };

describe('usePianoPreset', () => {
  it('loads the per-user preset on mount and on user change', async () => {
    store = { default: bundleA };
    const { result, rerender } = renderHook(() => usePianoPreset());
    await waitFor(() => expect(result.current.preset.default).toEqual(bundleA));
    expect(calls[0]).toEqual({ path: 'api/v1/piano/users/user_1/preset', data: {}, method: 'GET' });

    store = { default: bundleB };
    mockUser = 'user_2';
    rerender();
    await waitFor(() => expect(result.current.preset.default).toEqual(bundleB));
    expect(calls.some((c) => c.path === 'api/v1/piano/users/user_2/preset' && c.method === 'GET')).toBe(true);
  });

  it('auto-applies preset.default via usePianoSoundBundle().applyBundle', async () => {
    store = { default: bundleA };
    renderHook(() => usePianoPreset());
    await waitFor(() => expect(applyBundle).toHaveBeenCalledWith(bundleA));
  });

  it('does NOT apply/reset the sound when there is no default (graceful degrade)', async () => {
    store = { favorites: [bundleB] };
    const { result } = renderHook(() => usePianoPreset());
    await waitFor(() => expect(result.current.preset.favorites).toEqual([bundleB]));
    expect(applyBundle).not.toHaveBeenCalled();
  });

  it('saveDefault PUTs { default: bundle }', async () => {
    const { result } = renderHook(() => usePianoPreset());
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => { await result.current.saveDefault(bundleA); });
    expect(result.current.preset.default).toEqual(bundleA);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('api/v1/piano/users/user_1/preset');
    expect(put.data).toEqual({ default: bundleA });
  });

  it('addFavorite PUTs { favorites: [...existing, bundle] }', async () => {
    store = { favorites: [bundleA] };
    const { result } = renderHook(() => usePianoPreset());
    await waitFor(() => expect(result.current.preset.favorites).toEqual([bundleA]));
    await act(async () => { await result.current.addFavorite(bundleB); });
    expect(result.current.preset.favorites).toEqual([bundleA, bundleB]);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('api/v1/piano/users/user_1/preset');
    expect(put.data).toEqual({ favorites: [bundleA, bundleB] });
  });

  it('addFavorite dedups an existing favorite with the same voice pc:bank', async () => {
    const staleA = { voice: { pc: 0, bank: 0 }, reverb: null, chorus: null, volume: 0.2 };
    const freshA = { voice: { pc: 0, bank: 0 }, reverb: { type: 1, level: 20, on: true }, chorus: null, volume: 0.9 };
    store = { favorites: [staleA, bundleB] };
    const { result } = renderHook(() => usePianoPreset());
    await waitFor(() => expect(result.current.preset.favorites).toEqual([staleA, bundleB]));
    await act(async () => { await result.current.addFavorite(freshA); });
    // The old pc:0/bank:0 entry is dropped in favor of the new one; order preserved (bundleB, then new).
    expect(result.current.preset.favorites).toEqual([bundleB, freshA]);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.data).toEqual({ favorites: [bundleB, freshA] });
  });

  it('does not fetch when there is no current user', () => {
    mockUser = null;
    const { result } = renderHook(() => usePianoPreset());
    expect(result.current.preset).toEqual({});
    expect(calls.length).toBe(0);
    expect(applyBundle).not.toHaveBeenCalled();
  });
});
