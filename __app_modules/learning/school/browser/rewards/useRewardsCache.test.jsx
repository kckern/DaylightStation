import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useRewardsCache from './useRewardsCache.js';
import { createRewardsCache } from './rewardsCache.js';

const handlers = vi.hoisted(() => ({}));
vi.mock('../../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, callback) => { handlers[topic] = callback; },
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('preloads once, polls each minute, coalesces relevant events and stops polling on unmount', async () => {
  vi.useFakeTimers();
  const api = Object.fromEntries(['earningsRoster', 'wallet', 'gems', 'stateGates'].map(name => [name, vi.fn(async () => ({ ok: true, data: {} }))]));
  const cache = createRewardsCache(api);
  const { unmount } = renderHook(() => useRewardsCache([{ id: 'one' }], true, cache));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.earningsRoster).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.earningsRoster).toHaveBeenCalledTimes(2);
  act(() => {
    for (let n = 0; n < 5; n += 1) handlers.school({ event: 'coins-changed', learnerId: 'one' });
  });
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(api.earningsRoster).toHaveBeenCalledTimes(3);
  act(() => handlers['state-gates']({ payload: { gateId: 'unrelated' } }));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.earningsRoster).toHaveBeenCalledTimes(3);
  act(() => handlers['state-gates']({ payload: { gateId: 'fitness.weekly-rings' } }));
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(api.earningsRoster).toHaveBeenCalledTimes(4);
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(api.earningsRoster).toHaveBeenCalledTimes(4);
});
