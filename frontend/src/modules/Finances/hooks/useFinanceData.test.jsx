import { renderHook, act, waitFor } from '@testing-library/react';
import { useFinanceData } from './useFinanceData.mjs';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const SAMPLE = {
  budgets: { '2026-01-01': { budgetStart: '2026-01-01' } },
  mortgage: { balance: 100000 }
};

describe('useFinanceData', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  test('loads budgets and mortgage together on mount', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE);
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));
    expect(result.current.error).toBeNull();
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/finance/data');
  });

  test('surfaces a failed load as error state (no infinite Loading)', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('HTTP 500'));
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });

  test('refresh POSTs /refresh then reloads BOTH budgets and mortgage', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE); // mount load
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));

    const refreshed = {
      budgets: { '2026-01-01': { budgetStart: '2026-01-01', changed: true } },
      mortgage: { balance: 99000 }
    };
    DaylightAPI.mockResolvedValueOnce({ ok: true }); // POST refresh
    DaylightAPI.mockResolvedValueOnce(refreshed);    // reload
    await act(() => result.current.refresh());

    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/finance/refresh', {}, 'POST');
    expect(result.current.data).toEqual(refreshed); // mortgage updated too — audit 2.2
    expect(result.current.refreshing).toBe(false);
  });

  test('a failed refresh clears the refreshing flag and sets error', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE);
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));

    DaylightAPI.mockRejectedValueOnce(new Error('refresh boom'));
    await act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
