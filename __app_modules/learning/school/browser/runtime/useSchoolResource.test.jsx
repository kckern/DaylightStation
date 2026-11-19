import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSchoolResource } from './useSchoolResource.js';
import { createSchoolResourceStore } from './schoolResources.js';

it('keeps the selected learner visible when an earlier learner read completes late', async () => {
  const store = createSchoolResourceStore();
  let finishFirst;
  const { result, rerender } = renderHook(({ id }) => useSchoolResource({
    store, key: ['reader', id], load: () => id === 'first' ? new Promise(resolve => { finishFirst = resolve; })
      : Promise.resolve({ ok: true, data: 'Second learner' }),
  }), { initialProps: { id: 'first' } });
  await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
  rerender({ id: 'second' });
  await waitFor(() => expect(result.current.data).toBe('Second learner'));
  await act(async () => finishFirst({ ok: true, data: 'First learner' }));
  expect(result.current.data).toBe('Second learner');
});
