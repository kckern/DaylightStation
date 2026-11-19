// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useRefreshableRead } from './useRefreshableRead.js';

it('cancels replaced requests and retires readers when their owner changes or unmounts', async () => {
  const calls = [];
  const read = (isCurrent, signal) => new Promise(resolve => {
    calls.push({ isCurrent, signal, resolve });
  });
  const first = (isCurrent, signal) => read(isCurrent, signal);
  const second = (isCurrent, signal) => read(isCurrent, signal);
  const { result, rerender, unmount } = renderHook(
    ({ read }) => useRefreshableRead(read), { initialProps: { read: first } },
  );
  const retiredReload = result.current.reload;
  act(() => { retiredReload(); });
  act(() => { result.current.poll(); });
  expect(calls).toHaveLength(1);

  act(() => { retiredReload(); });
  expect(calls[0].signal?.aborted).toBe(true);
  expect(calls[0].isCurrent()).toBe(false);
  expect(calls[1].isCurrent()).toBe(true);

  rerender({ read: second });
  expect(calls[1].signal.aborted).toBe(true);
  await retiredReload();
  expect(calls).toHaveLength(2);

  act(() => { result.current.reload(); });
  expect(calls[2].signal.aborted).toBe(false);
  unmount();
  expect(calls[2].signal.aborted).toBe(true);
  expect(calls[2].isCurrent()).toBe(false);
  await act(async () => { calls.forEach(({ resolve }) => resolve()); });
});
