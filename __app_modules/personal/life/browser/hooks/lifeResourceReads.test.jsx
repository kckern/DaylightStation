import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { useAlignment } from './useAlignment.js';
import { useLifelog } from './useLifelog.js';
import { useGoalDetail, useGoals } from './useLifePlan.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

beforeEach(() => { DaylightAPI.mockReset(); });

it('switches alignment and log reads by query and discards superseded answers', async () => {
  const pending = new Map();
  DaylightAPI.mockImplementation(path => new Promise(resolve => pending.set(path, resolve)));
  const reads = renderHook(({ user, mode, scope }) => ({
    alignment: useAlignment(mode, user),
    log: useLifelog({ username: user, scope, at: '2026-01' }),
  }), { initialProps: { user: 'alice', mode: 'priorities', scope: 'month' } });
  const previous = [...pending.values()];
  expect(previous).toHaveLength(2);
  reads.rerender({ user: 'bob & co', mode: 'dashboard', scope: 'week' });
  await act(async () => {
    pending.get('api/v1/life/now?mode=dashboard&username=bob+%26+co')({ owner: 'bob' });
    pending.get('/api/v1/life/log/bob%20%26%20co/scope/week?at=2026-01')({ owner: 'bob' });
  });
  await act(async () => previous.forEach(finish => finish({ owner: 'alice' })));
  expect(reads.result.current.alignment.data.owner).toBe('bob');
  expect(reads.result.current.log.data.owner).toBe('bob');
});

it('reconciles only the transitioned goal and owner and keeps the list command awaitable', async () => {
  const path = '/api/v1/life/plan/goals';
  const detail = path + '/goal?username=alice';
  let state = 'ready';
  let releaseList;
  DaylightAPI.mockImplementation(async (url, _data, method) => {
    if (method === 'POST') {
      state = 'committed';
      return { state };
    }
    if (url === path + '?username=alice') {
      if (state === 'committed') await new Promise(resolve => { releaseList = resolve; });
      return { goals: [] };
    }
    return { state: url === detail ? state : 'other' };
  });
  const current = renderHook(() => useGoalDetail('goal', 'alice'));
  const sibling = renderHook(() => useGoalDetail('another', 'alice'));
  const otherOwner = renderHook(() => useGoalDetail('goal', 'bob'));
  const list = renderHook(() => useGoals('alice'));
  await waitFor(() => expect(list.result.current.loading).toBe(false));
  expect(current.result.current.goal.state).toBe('ready');

  let completed = false;
  let command;
  await act(async () => {
    command = list.result.current.transitionGoal('goal', 'committed', 'Manual transition').then(result => {
      completed = true;
      return result;
    });
  });
  await waitFor(() => expect(current.result.current.goal.state).toBe('committed'));
  expect(DaylightAPI).toHaveBeenCalledWith(path + '/goal/transition?username=alice', { state: 'committed', reason: 'Manual transition' }, 'POST');
  expect(DaylightAPI.mock.calls.filter(([url]) => url === path + '/another?username=alice')).toHaveLength(1);
  expect(DaylightAPI.mock.calls.filter(([url]) => url === path + '/goal?username=bob')).toHaveLength(1);
  expect(sibling.result.current.goal.state).toBe('other');
  expect(otherOwner.result.current.goal.state).toBe('other');
  expect(completed).toBe(false);
  await act(async () => { releaseList(); expect(await command).toEqual({ state: 'committed' }); });

  DaylightAPI.mockRejectedValueOnce(new Error('Transition refused'));
  await expect(list.result.current.transitionGoal('goal', 'failed', 'Manual transition')).rejects.toThrow('Transition refused');
  expect(DaylightAPI.mock.calls.filter(([url]) => url === detail)).toHaveLength(2);
});
