import { it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { HealthOperationsProvider, useHealthOperations } from './HealthOperationsProvider.jsx';
it('dispatches once and ignores an old owner completion after unmount', async () => {
  let finish;
  const send = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const complete = vi.fn();
  const wrapper = ({children}) => <HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
  const { result, unmount } = renderHook(useHealthOperations, { wrapper });
  let pending;
  act(() => {
    result.current.store.begin({id:'one',targetIds:['a'],request:{path:'test',body:{operationId:'one'},method:'POST'}});
    pending = result.current.execute('one', complete);
    result.current.execute('one', complete);
  });
  expect(send).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish({committed:true}); await pending; });
  expect(complete).not.toHaveBeenCalled();
});
