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

import { usePianoPreferences } from './usePianoPreferences.js';

beforeEach(() => { calls.length = 0; store = {}; mockUser = 'user_1'; });

describe('usePianoPreferences', () => {
  it('loads the per-user blob on mount and exposes getPref with a fallback', async () => {
    store = { topPaneLayout: 'triptych' };
    const { result } = renderHook(() => usePianoPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.getPref('topPaneLayout', 'staff')).toBe('triptych');
    expect(result.current.getPref('missing', 'fallback')).toBe('fallback');
    expect(calls[0].path).toBe('api/v1/piano/users/user_1/preferences');
    expect(calls[0].method).toBe('GET');
  });

  it('setPref optimistically updates and PUTs a shallow-merge patch', async () => {
    const { result } = renderHook(() => usePianoPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.setPref('topPaneLayout', 'triptych'); });
    expect(result.current.getPref('topPaneLayout', 'staff')).toBe('triptych');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('api/v1/piano/users/user_1/preferences');
    expect(put.data).toEqual({ topPaneLayout: 'triptych' });
  });

  it('does not fetch when there is no current user', () => {
    mockUser = null;
    const { result } = renderHook(() => usePianoPreferences());
    expect(result.current.loaded).toBe(false);
    expect(calls.length).toBe(0);
  });
});
