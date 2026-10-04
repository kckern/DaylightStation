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
    if (data.learn) {
      next.learn = { ...(store.learn || {}), ...data.learn, passages: { ...(store.learn?.passages || {}) } };
      for (const [passageId, passage] of Object.entries(data.learn.passages || {})) {
        next.learn.passages[passageId] = {
          ...(next.learn.passages[passageId] || {}), ...passage,
          rungs: { ...(next.learn.passages[passageId]?.rungs || {}), ...(passage.rungs || {}) },
        };
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

const FP = { version: 2, measureCount: 40, xmlBytes: 12345, contentSha256: 'a'.repeat(64) };

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

  it('guest: no GET or PUT fires, but progress remains available for the session', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toHaveLength(0);
    act(() => {
      result.current.recordCycle({ measureIndices: [1, 2], wrongMeasures: new Set(), bucket: 'both' });
    });
    expect(calls).toHaveLength(0);
    expect(result.current.record.measures['1'].both).toEqual({ attempts: 1, passes: 1 });
  });

  it('a null user (roster pending or failed) runs history-less but LOADED — Learn auto-range must not wait on the roster', async () => {
    mockUser = null;
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toHaveLength(0); // no GET for a non-persistent user
    expect(result.current.persistent).toBe(false);
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
    store = { fingerprint: { version: 2, measureCount: 40, xmlBytes: 12345, contentSha256: 'b'.repeat(64) }, measures: { 1: { both: { attempts: 5, passes: 5 } } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.record).toEqual({});
  });

  it('treats legacy shape-only fingerprints as stale', async () => {
    store = { fingerprint: { measureCount: FP.measureCount, xmlBytes: FP.xmlBytes }, measures: { 1: { both: { attempts: 5, passes: 5 } } } };
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

  it('recordLearnRep banks cumulative reps and completes a passage at the configured requirement', async () => {
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.recordLearnRep({
      revision: 'ladder-a', passageId: 'm0-3', rungId: 'timed', result: { verdict: { passed: true } },
      requiredPasses: 2, completesPassage: true,
    }));
    act(() => result.current.recordLearnRep({
      revision: 'ladder-a', passageId: 'm0-3', rungId: 'timed', result: { verdict: { passed: true } },
      requiredPasses: 2, completesPassage: true,
    }));
    expect(result.current.record.learn.passages['m0-3']).toMatchObject({
      complete: true, completedBy: 'timed', rungs: { timed: { attempts: 2, passCount: 2 } },
    });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
  });

  it('a failed consecutive rung resets only that rung while a normal rung keeps banked reps', async () => {
    store = { fingerprint: FP, learn: { revision: 'ladder-a', passages: { 'm0-3': { rungs: {
      right: { attempts: 2, passCount: 2 }, 'test-out': { attempts: 2, passCount: 2 },
    } } } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.recordLearnRep({
      revision: 'ladder-a', passageId: 'm0-3', rungId: 'test-out', result: { verdict: { passed: false } }, consecutive: true, requiredPasses: 3,
    }));
    expect(result.current.record.learn.passages['m0-3'].rungs).toMatchObject({
      right: { passCount: 2 }, 'test-out': { attempts: 3, passCount: 0 },
    });
  });

  it('records declarative Test Out completion without branching on its rung id', async () => {
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.recordLearnRep({
      revision: 'ladder-a', passageId: 'm0-3', rungId: 'audition', result: { verdict: { passed: true } },
      requiredPasses: 1, completesPassage: true, completion: 'tested-out',
    }));
    expect(result.current.record.learn.passages['m0-3']).toMatchObject({ complete: true, testedOut: true, completedBy: 'audition' });
  });

  it('a new ladder revision starts fresh passage progress without discarding measure history', async () => {
    store = { fingerprint: FP, measures: { 0: { rh: { attempts: 3, passes: 3 } } }, learn: { revision: 'old', passages: { old: { complete: true } } } };
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.recordLearnRep({
      revision: 'new', passageId: 'm0-3', rungId: 'right', result: { verdict: { passed: true } }, requiredPasses: 6,
    }));
    expect(result.current.record.measures['0'].rh.passes).toBe(3);
    expect(result.current.record.learn).toEqual({
      revision: 'new', passages: { 'm0-3': { rungs: { right: { attempts: 1, passCount: 1 } }, complete: false } },
    });
  });
});
