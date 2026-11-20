import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const api = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => api(...a) }));
vi.mock("./useLifeUser.js", () => ({ useLifeUsername: () => 'alice' }));
import { useTriage } from "./useTriage.js";

beforeEach(() => api.mockReset());

describe('useTriage', () => {
  it('loads the summary for the selected user', async () => {
    api.mockResolvedValueOnce({ enrolled: true });
    const { result } = renderHook(() => useTriage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.mock.calls[0][0]).toBe('api/v1/triage/summary?username=alice');
    expect(result.current.summary).toEqual({ enrolled: true });
  });
  it('a 401 login_required on a write sets needsLogin', async () => {
    api.mockResolvedValueOnce({ enrolled: true });
    const { result } = renderHook(() => useTriage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401, body: { error: 'login_required' } }));
    let err;
    await act(async () => { err = await result.current.skip('c1').catch((e) => e); });
    expect(err.code).toBe('login_required');
    expect(result.current.needsLogin).toBe(true);
  });
  it('resolve posts happened to the card', async () => {
    api.mockResolvedValueOnce({ enrolled: true });
    const { result } = renderHook(() => useTriage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.mockResolvedValueOnce({ outcome: 'reopened' });
    await act(async () => { await result.current.resolve('c1', false); });
    expect(api).toHaveBeenLastCalledWith('api/v1/triage/cards/c1/resolve?username=alice', { happened: false }, 'POST');
  });
});
