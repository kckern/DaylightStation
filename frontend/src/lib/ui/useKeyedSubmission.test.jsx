import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useKeyedSubmission } from './useKeyedSubmission.js';

it('lets an admitted command finish and rejects new work from a retired view', async () => {
  const held = Promise.withResolvers();
  const { result, unmount } = renderHook(() => useKeyedSubmission());
  const { run } = result.current;
  let pending;

  act(() => { pending = run('first', () => held.promise); });
  expect(result.current.pending.has('first')).toBe(true);
  unmount();

  const lateCommand = vi.fn();
  await run('second', lateCommand);
  expect(lateCommand).not.toHaveBeenCalled();

  held.resolve('finished');
  await expect(pending).resolves.toBe('finished');
});
