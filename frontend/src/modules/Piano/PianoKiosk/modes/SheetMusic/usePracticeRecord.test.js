import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let store = {}; // simulated per-user practice record on the server
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path, data = {}, method = 'GET') => {
    calls.push({ path, data, method });
    if (method === 'GET' && Object.keys(data).length === 0) return { ...store };
    // PUT: shallow-merge measures/polish (mirrors the backend's per-key merge)
    const next = { ...store, ...data };
    if (data.measures) next.measures = { ...(store.measures || {}), ...data.measures };
    if (data.polish) {
      next.polish = { ...(store.polish || {}) };
      for (const bucket of Object.keys(data.polish)) {
        next.polish[bucket] = { ...(next.polish[bucket] || {}), ...data.polish[bucket] };
      }
    }
    store = next;
    return { ...store };
  }),
}));

let mockUser = 'kc';
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: mockUser }),
}));

import usePracticeRecord from './usePracticeRecord.js';

const FP = { measureCount: 40, xmlBytes: 12345 };

beforeEach(() => { calls.length = 0; store = {}; mockUser = 'kc'; });

describe('usePracticeRecord', () => {
  it('loads the record for a persistent user', async () => {
    store = { fingerprint: FP, measures: { 3: { both: { attempts: 2, passes: 1 } } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls[0].path).toBe('api/v1/piano/users/kc/practice/files-x-musicxml');
    expect(calls[0].method).toBe('GET');
    expect(result.current.record.measures['3'].both).toEqual({ attempts: 2, passes: 1 });
  });

  it('guest: no GET fired, loaded true, recordCycle is a no-op', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toHaveLength(0);
    act(() => {
      result.current.recordCycle({ measureIndices: [1, 2], wrongMeasures: new Set(), bucket: 'both' });
    });
    expect(calls).toHaveLength(0);
    expect(result.current.record).toEqual({});
  });

  it('reports whether writes can persist, so callers can log WHY a write was skipped', async () => {
    // Without this, a caller logging "no best banked" cannot distinguish a guest
    // (nothing can ever persist) from a run that simply was not an improvement —
    // the two look identical from outside the hook (empty record, silent no-op).
    const persistent = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(persistent.result.current.loaded).toBe(true));
    expect(persistent.result.current.persistent).toBe(true);

    mockUser = 'guest';
    const guest = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(guest.result.current.loaded).toBe(true));
    expect(guest.result.current.persistent).toBe(false);
  });

  it('recordCycle: increments attempts/passes for only the touched measures and PUTs only those', async () => {
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.recordCycle({ measureIndices: [4, 5], wrongMeasures: new Set([5]), bucket: 'rh' });
    });

    await waitFor(() => {
      expect(result.current.record.measures['4'].rh).toEqual({ attempts: 1, passes: 1 });
      expect(result.current.record.measures['5'].rh).toEqual({ attempts: 1, passes: 0 });
    });

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put.path).toBe('api/v1/piano/users/kc/practice/files-x-musicxml');
    expect(put.data.fingerprint).toEqual(FP);
    expect(Object.keys(put.data.measures).sort()).toEqual(['4', '5']);
    expect(put.data.measures['4'].rh).toEqual({ attempts: 1, passes: 1 });
    expect(put.data.measures['5'].rh).toEqual({ attempts: 1, passes: 0 });
  });

  it('fingerprint mismatch on load: server record is discarded, record is {}', async () => {
    store = { fingerprint: { measureCount: 999, xmlBytes: 1 }, measures: { 1: { both: { attempts: 5, passes: 5 } } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.record).toEqual({});
  });

  it('recordTierBest: keeps the max, only PUTs on improvement', async () => {
    store = { fingerprint: FP, polish: { rh: { full: 95 } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.recordTierBest({ bucket: 'rh', tier: 'full', score: 80 });
    });
    expect(result.current.record.polish.rh.full).toBe(95);
    expect(calls.find((c) => c.method === 'PUT')).toBeUndefined();

    act(() => {
      result.current.recordTierBest({ bucket: 'rh', tier: 'full', score: 97 });
    });
    await waitFor(() => expect(result.current.record.polish.rh.full).toBe(97));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put.data).toEqual({ fingerprint: FP, polish: { rh: { full: 97 } } });
  });
});
