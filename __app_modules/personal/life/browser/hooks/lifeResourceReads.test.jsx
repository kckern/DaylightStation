import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { LifeUserContext } from './useLifeUser.js';
import { resetApiResourceCache } from '@/lib/hooks/useApiResource.js';
import { useAlignment } from './useAlignment.js';
import { useLifelog } from './useLifelog.js';
import { useGoalDetail, useGoals, useLifePlan } from './useLifePlan.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

beforeEach(() => { DaylightAPI.mockReset(); resetApiResourceCache(); });

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

it('shares the selected plan with explicit readers and serves it on remount', async () => {
  const plan = { purpose: { statement: 'Build things' } };
  let finish;
  DaylightAPI.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const wrapper = ({ children }) => <LifeUserContext.Provider value={{ username: 'amy & co' }}>{children}</LifeUserContext.Provider>;
  const first = renderHook(() => useLifePlan(), { wrapper });
  const second = renderHook(() => useLifePlan('amy & co'));
  expect(DaylightAPI.mock.calls.map(([path]) => path)).toEqual(['/api/v1/life/plan/?username=amy%20%26%20co']);
  await act(async () => finish(plan));
  expect(first.result.current.plan).toEqual(plan);
  expect(second.result.current.plan).toEqual(plan);
  first.unmount();
  second.unmount();
  const next = renderHook(() => useLifePlan(), { wrapper });
  expect(next.result.current.plan).toEqual(plan);
  expect(next.result.current.loading).toBe(false);
});

it('keeps a late filtered goal list out of the current member and filter', async () => {
  const pending = new Map();
  DaylightAPI.mockImplementation(path => new Promise(resolve => pending.set(path, resolve)));
  const reader = renderHook(({ user, state }) => useGoals(user, state), { initialProps: { user: 'amy', state: 'dream' } });
  reader.rerender({ user: 'bob & co', state: 'ready' });
  await act(async () => pending.get('/api/v1/life/plan/goals?username=bob+%26+co&state=ready')({ goals: [{ id: 'ready-bob' }] }));
  await act(async () => pending.get('/api/v1/life/plan/goals?username=amy&state=dream')({ goals: [{ id: 'dream-amy' }] }));
  expect(reader.result.current.goals).toEqual([{ id: 'ready-bob' }]);
});

it('finishes a committed purpose save after switching members without dispatching another read', async () => {
  let finishSave;
  DaylightAPI.mockImplementation((path, data, method) => method === 'POST'
    ? new Promise(resolve => { finishSave = resolve; })
    : Promise.resolve({ purpose: { statement: path } }));
  const reader = renderHook(({ user }) => useLifePlan(user), { initialProps: { user: 'amy' } });
  await waitFor(() => expect(reader.result.current.loading).toBe(false));
  const saved = reader.result.current.setPurpose('Practice');
  reader.rerender({ user: 'bob' });
  await waitFor(() => expect(reader.result.current.loading).toBe(false));
  await act(async () => {
    finishSave({ statement: 'Practice' });
    expect(await saved).toEqual({ statement: 'Practice' });
  });
  expect(reader.result.current.plan.purpose.statement).toBe('/api/v1/life/plan/?username=bob');
  expect(DaylightAPI.mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/life/plan/?username=amy', '/api/v1/life/plan/purpose?username=amy', '/api/v1/life/plan/?username=bob',
  ]);
  let finishPlan;
  DaylightAPI.mockImplementationOnce(() => new Promise(resolve => { finishPlan = resolve; }));
  reader.rerender({ user: 'amy' });
  expect(reader.result.current.loading).toBe(true);
  expect(reader.result.current.plan).toBeNull();
  await act(async () => finishPlan({ purpose: { statement: 'Practice' } }));
  expect(reader.result.current.plan.purpose.statement).toBe('Practice');
});

it('preserves the current member’s section failure when a previous member’s save finishes', async () => {
  let finishSave;
  DaylightAPI.mockImplementation((path, _data, method) => {
    if (method === 'POST') return new Promise(resolve => { finishSave = resolve; });
    if (method === 'PATCH') return Promise.reject(new Error('Cannot reorder'));
    return Promise.resolve({});
  });
  const reader = renderHook(({ user }) => useLifePlan(user), { initialProps: { user: 'amy' } });
  await waitFor(() => expect(reader.result.current.loading).toBe(false));
  const saved = reader.result.current.setPurpose('Practice');
  reader.rerender({ user: 'bob' });
  await waitFor(() => expect(reader.result.current.loading).toBe(false));
  await act(async () => {
    await expect(reader.result.current.updateSection('values', [])).rejects.toThrow('Cannot reorder');
  });
  expect(reader.result.current.error).toBe('Cannot reorder');
  await act(async () => { finishSave({}); await saved; });
  expect(reader.result.current.error).toBe('Cannot reorder');
});

it('drops a warm empty plan after authoring the member’s first goal', async () => {
  const aggregate = '/api/v1/life/plan/?username=amy';
  const created = { id: 'practice', state: 'dream' };
  let committed = false;
  let finishPlan;
  DaylightAPI.mockImplementation(async (path, _data, method) => {
    if (method === 'POST') { committed = true; return created; }
    if (path === aggregate) {
      if (!committed) return {};
      return new Promise(resolve => { finishPlan = resolve; });
    }
    return { goals: committed ? [created] : [] };
  });
  const first = renderHook(() => useLifePlan('amy'));
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  first.unmount();
  const goals = renderHook(() => useGoals('amy'));
  await waitFor(() => expect(goals.result.current.loading).toBe(false));
  let save;
  await act(async () => { save = goals.result.current.createGoal({ name: 'Practice' }); });
  await expect(save).resolves.toEqual(created);
  goals.unmount();

  const dashboardPlan = renderHook(() => useLifePlan('amy'));
  expect(dashboardPlan.result.current.loading).toBe(true);
  await act(async () => finishPlan({ goals: [created] }));
  expect(dashboardPlan.result.current.isEmpty).toBe(false);
});
