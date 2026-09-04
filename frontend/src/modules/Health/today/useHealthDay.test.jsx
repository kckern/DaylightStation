import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useHealthDay } from './useHealthDay.js';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const ROWS = [
  { uuid: '1', name: 'Eggs', calories: 140, mealTime: 'morning' },
  { uuid: '2', name: 'Sandwich', calories: 400, mealTime: 'afternoon' },
  { uuid: '3', name: 'Mystery', calories: 100 }, // no mealTime → ungrouped
];
const NUTRILIST_ENVELOPE = { message: 'ok', data: ROWS, date: '2026-09-02', count: 3 };
const BUDGET = { budget: 2100, food: 640, exercise: 0, remaining: 1460, status: 'under', sessions: [] };

describe('useHealthDay', () => {
  beforeEach(() => {
    apiMock.mockReset();
    // The swr cache is module-level and keyed by path — every test in this
    // file uses the SAME date, so without a reset, an earlier test's
    // cached payload would leak into a later test's "cold" mount (loading
    // would read false when the test expects a true cold start).
    resetApiResourceCache();
    apiMock.mockImplementation(async (path) =>
      ({ items: ROWS, budget: BUDGET, revision: 1 }));
  });

  it('groups rows by mealTime with null → ungrouped', async () => {
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.byBucket.get('morning')).toHaveLength(1);
    expect(result.current.byBucket.get('afternoon')).toHaveLength(1);
    expect(result.current.byBucket.get(null)).toHaveLength(1);
    expect(result.current.budget.remaining).toBe(1460);
  });

  it('a failing budget endpoint leaves the log usable', async () => {
    apiMock.mockImplementation(async (path) => {
      return { items: ROWS, budget: null, budgetError: { code: 'GOALS_NOT_CONFIGURED' } };
    });
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.budget).toBeNull();
    expect(result.current.budgetError.code).toBe('GOALS_NOT_CONFIGURED');
  });

  it('unwraps bare array for backward compatibility', async () => {
    apiMock.mockImplementation(async (path) =>
      path.includes('/budget') ? BUDGET : ROWS);
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.byBucket.get('morning')).toHaveLength(1);
  });

  it('mutate runs the action then reloads', async () => {
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const action = vi.fn(async () => {});
    const callsBefore = apiMock.mock.calls.length;
    await act(() => result.current.mutate(action));
    expect(action).toHaveBeenCalled();
    expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // Task 3.2: swr:true on both resources — a mutation's reload() must never
  // flip `loading` back to true once the day has loaded once. `revalidating`
  // is the seam the view uses instead to know a background refresh is live.
  it('reload() after the first load revalidates quietly: loading never flips back to true, revalidating does', async () => {
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.revalidating).toBe(false);

    let resolveNutrilist;
    apiMock.mockImplementation((path) => {
      if (path.includes('/budget')) return Promise.resolve(BUDGET);
      return new Promise((r) => { resolveNutrilist = r; });
    });

    act(() => { result.current.reload(); });
    // Synchronously after the reload-triggering act() flushes effects: the
    // cached day is still showing, loading never observed true.
    expect(result.current.loading).toBe(false);
    expect(result.current.revalidating).toBe(true);
    expect(result.current.items).toHaveLength(3); // stale-but-present, not cleared

    await act(async () => { resolveNutrilist(NUTRILIST_ENVELOPE); await Promise.resolve(); });
    await waitFor(() => expect(result.current.revalidating).toBe(false));
    expect(result.current.loading).toBe(false);
  });

  it('a second mount of the same date serves cached data immediately with loading:false (SWR cache hit)', async () => {
    const first = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useHealthDay('2026-09-02'));
    // No waitFor — this is the very first render after mount.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.items).toHaveLength(3);
  });
});
