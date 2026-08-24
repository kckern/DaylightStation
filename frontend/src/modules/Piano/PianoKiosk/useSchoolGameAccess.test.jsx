import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ response: { state: 'incomplete' } }));

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => h.response),
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ warn: vi.fn() }) }),
}));

import { DaylightAPI } from '../../../lib/api.mjs';
import useSchoolGameAccess, { completionAllowsGames } from './useSchoolGameAccess.js';

beforeEach(() => {
  h.response = { state: 'incomplete' };
  DaylightAPI.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('completionAllowsGames', () => {
  it.each(['complete', 'no_work_today'])('unlocks for %s', (state) => {
    expect(completionAllowsGames(state)).toBe(true);
  });

  it.each(['incomplete', null, 'plan_error'])('does not unlock for %s', (state) => {
    expect(completionAllowsGames(state)).toBe(false);
  });
});

describe('useSchoolGameAccess', () => {
  it('keeps an incomplete learner locked', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ state: 'incomplete', unlocked: false });
    expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/school/lifecycle/learners/kid-one/completion',
    );
  });

  it('unlocks a learner with no work today', async () => {
    h.response = { state: 'no_work_today' };
    const { result } = renderHook(() => useSchoolGameAccess('kid one'));
    await waitFor(() => expect(result.current.unlocked).toBe(true));
    expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/school/lifecycle/learners/kid%20one/completion',
    );
  });

  it('unlocks Guest without asking School for a nonexistent learner', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('guest'));
    await waitFor(() => expect(result.current.unlocked).toBe(true));
    expect(result.current.state).toBe('no_work_today');
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('fails closed when the completion read fails', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.unlocked).toBe(false);
  });

  it('does not carry one player\'s unlock across an identity switch', async () => {
    h.response = { state: 'complete' };
    const { result, rerender } = renderHook(
      ({ learnerId }) => useSchoolGameAccess(learnerId),
      { initialProps: { learnerId: 'kid-one' } },
    );
    await waitFor(() => expect(result.current.unlocked).toBe(true));

    // The new read has not resolved yet, but the old player's permission is
    // already gone synchronously.
    h.response = new Promise(() => {});
    rerender({ learnerId: 'kid-two' });
    expect(result.current).toMatchObject({ status: 'loading', unlocked: false });
  });

  it('refreshes completion while the kiosk remains mounted', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.unlocked).toBe(false);

    h.response = { state: 'complete' };
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current).toMatchObject({ state: 'complete', unlocked: true });
  });
});
