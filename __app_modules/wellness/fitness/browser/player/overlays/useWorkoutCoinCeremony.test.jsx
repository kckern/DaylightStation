import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));

import { useWorkoutCoinCeremony, WORKOUT_FINISHED_EVENT } from './useWorkoutCoinCeremony.js';

const fire = (sessionId) => act(async () => { window.dispatchEvent(new CustomEvent(WORKOUT_FINISHED_EVENT, { detail: { sessionId } })); });
const learner = { learnerId: 'learner-a', learnerName: 'A', rings: 120, gained: { silver: 2, gems: 0 }, total: { silver: 10 }, nextCoinIn: null };

describe('useWorkoutCoinCeremony', () => {
  beforeEach(() => { api.mockReset(); sessionStorage.clear(); logSpy.info.mockClear(); });

  it('fetches the workout earnings and opens the ceremony', async () => {
    api.mockResolvedValue({ mode: 'live', learners: [learner] });
    const { result } = renderHook(() => useWorkoutCoinCeremony());
    await fire('s1');
    await waitFor(() => expect(result.current.ceremony).toEqual({ sessionId: 's1', learners: [learner] }));
    expect(api).toHaveBeenCalledWith('/api/v1/earnings/workout/s1');
  });

  it('shows a session once, even if it finishes twice', async () => {
    api.mockResolvedValue({ mode: 'live', learners: [learner] });
    const { result } = renderHook(() => useWorkoutCoinCeremony());
    await fire('s1');
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    act(() => result.current.dismiss());
    await fire('s1');
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current.ceremony).toBeNull();
  });

  it('skips (and logs) when nobody earned anything, the economy is off, or the call fails', async () => {
    const { result } = renderHook(() => useWorkoutCoinCeremony());
    api.mockResolvedValueOnce({ mode: 'live', learners: [] });
    await fire('s1');
    api.mockResolvedValueOnce({ mode: 'off', learners: [] });
    await fire('s2');
    api.mockRejectedValueOnce(new Error('boom'));
    await fire('s3');
    await waitFor(() => expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.skipped', expect.objectContaining({ sessionId: 's3', reason: 'fetch-failed' })));
    expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.skipped', expect.objectContaining({ sessionId: 's1', reason: 'no-earnings' }));
    expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.skipped', expect.objectContaining({ sessionId: 's2', reason: 'economy-off' }));
    expect(result.current.ceremony).toBeNull();
  });
});
