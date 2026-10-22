import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));

import { useWorkoutCoinCeremony, WORKOUT_FINISHED_EVENT, announceWorkoutFinished } from './useWorkoutCoinCeremony.js';

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

  it('shows the same session again only when it has more rings (a second video), logging the skip otherwise', async () => {
    api.mockResolvedValue({ mode: 'live', learners: [learner] });
    const { result } = renderHook(() => useWorkoutCoinCeremony());
    await fire('s1');
    await waitFor(() => expect(result.current.ceremony).not.toBeNull());
    act(() => result.current.dismiss());
    // The same close reported twice (X then the watchdog): same rings → skipped.
    await fire('s1');
    await waitFor(() => expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.skipped', expect.objectContaining({ sessionId: 's1', reason: 'already-shown' })));
    expect(result.current.ceremony).toBeNull();
    // A second video in the same session: more rings → shown again.
    api.mockResolvedValue({ mode: 'live', learners: [{ ...learner, rings: 300 }] });
    await fire('s1');
    await waitFor(() => expect(result.current.ceremony?.learners[0].rings).toBe(300));
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

describe('announceWorkoutFinished', () => {
  it('fires once the session settles, only when the close lands on the finished session', async () => {
    const seen = [];
    const on = (e) => seen.push(e.detail.sessionId);
    window.addEventListener(WORKOUT_FINISHED_EVENT, on);
    try {
      const session = { whenFinalPersistSettled: () => Promise.resolve() };
      await announceWorkoutFinished({ sessionId: 's1', redirect: { view: 'screen' }, session });
      await announceWorkoutFinished({ sessionId: 's2', redirect: { returnToShow: true }, session });
      await announceWorkoutFinished({ sessionId: null, redirect: { view: 'screen' }, session });
      await announceWorkoutFinished({ sessionId: 's3', redirect: null, session });
      // Still fires when the save rejects or there is no session object.
      await announceWorkoutFinished({ sessionId: 's4', redirect: {}, session: { whenFinalPersistSettled: () => Promise.reject(new Error('x')) } });
      await announceWorkoutFinished({ sessionId: 's5', redirect: {}, session: null });
      expect(seen).toEqual(['s1', 's4', 's5']);
    } finally { window.removeEventListener(WORKOUT_FINISHED_EVENT, on); }
  });
});
