import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ roster: [] }));

vi.mock('../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({ users: h.roster })),
}));
vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ warn: vi.fn(), info: vi.fn() }) }),
}));

import useLauncherUser, { STORAGE_KEY } from './useLauncherUser.js';

const ROSTER = [{ id: 'learner-one', name: 'Learner One' }, { id: 'test-user', name: 'Test User' }];

beforeEach(() => {
  h.roster = ROSTER;
  window.localStorage.clear();
  // Local-time constructors, not UTC strings: the study day is a LOCAL 4am
  // boundary, so a UTC fixture would drift the expected date with the runner's
  // timezone and make these pass or fail by geography.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('useLauncherUser remembered identity', () => {
  // 2026-09-02: the office screen locked Games against a profile picked five
  // days earlier. The pick itself is fine — remembering it is the whole point —
  // but a pick made on an earlier study day cannot answer a question that is
  // scoped to today's study day, which is exactly what the school gate asks.
  it('reports a pick from an earlier study day as stale', async () => {
    vi.setSystemTime(new Date(2026, 8, 2, 11, 26));
    window.localStorage.setItem(
      STORAGE_KEY, JSON.stringify({ id: 'learner-one', studyDate: '2026-08-28' }),
    );

    const { result } = renderHook(() => useLauncherUser());

    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.currentUser).toBe('learner-one');
    expect(result.current.identityStale).toBe(true);
  });

  it('reports a pick made today as fresh', async () => {
    vi.setSystemTime(new Date(2026, 8, 2, 11, 26));
    window.localStorage.setItem(
      STORAGE_KEY, JSON.stringify({ id: 'learner-one', studyDate: '2026-09-02' }),
    );

    const { result } = renderHook(() => useLauncherUser());

    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.currentUser).toBe('learner-one');
    expect(result.current.identityStale).toBe(false);
  });

  // The key held a bare id string before this change. Such a value carries no
  // date, so it cannot be shown to be today's — and the safe reading of "cannot
  // be shown to be today's" is stale.
  it('treats a legacy bare-id value as stale', async () => {
    vi.setSystemTime(new Date(2026, 8, 2, 11, 26));
    window.localStorage.setItem(STORAGE_KEY, 'learner-one');

    const { result } = renderHook(() => useLauncherUser());

    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.currentUser).toBe('learner-one');
    expect(result.current.identityStale).toBe(true);
  });

  it('stamps a fresh pick with the study day so it reads fresh straight away', async () => {
    vi.setSystemTime(new Date(2026, 8, 2, 11, 26));
    const { result } = renderHook(() => useLauncherUser());
    await waitFor(() => expect(result.current.users).toHaveLength(2));

    act(() => result.current.pickUser('test-user'));

    expect(result.current.currentUser).toBe('test-user');
    expect(result.current.identityStale).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)))
      .toEqual({ id: 'test-user', studyDate: '2026-09-02' });
  });

  // The study day starts at 4am, not midnight: a pick at 11pm is still current
  // at 1am. Rolling at midnight would send a player back to the roster in the
  // middle of the evening they are already in.
  it('keeps a late-evening pick fresh past midnight', async () => {
    vi.setSystemTime(new Date(2026, 8, 3, 0, 30)); // 00:30 local — still the 09-02 study day
    window.localStorage.setItem(
      STORAGE_KEY, JSON.stringify({ id: 'learner-one', studyDate: '2026-09-02' }),
    );

    const { result } = renderHook(() => useLauncherUser());

    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.identityStale).toBe(false);
  });

  it('has no stale identity to report when nobody is remembered', async () => {
    const { result } = renderHook(() => useLauncherUser());
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.currentUser).toBeNull();
    expect(result.current.identityStale).toBe(false);
  });
});
