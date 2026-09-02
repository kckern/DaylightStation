import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useHealthDay } from './useHealthDay.js';

const ROWS = [
  { uuid: '1', name: 'Eggs', calories: 140, mealTime: 'morning' },
  { uuid: '2', name: 'Sandwich', calories: 400, mealTime: 'afternoon' },
  { uuid: '3', name: 'Mystery', calories: 100 }, // no mealTime → ungrouped
];
const BUDGET = { budget: 2100, food: 640, exercise: 0, remaining: 1460, status: 'under', sessions: [] };

describe('useHealthDay', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) =>
      path.includes('/budget') ? BUDGET : ROWS);
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
      if (path.includes('/budget')) { const e = new Error('409'); e.status = 409; throw e; }
      return ROWS;
    });
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.budget).toBeNull();
    expect(result.current.budgetError.status).toBe(409);
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
});
