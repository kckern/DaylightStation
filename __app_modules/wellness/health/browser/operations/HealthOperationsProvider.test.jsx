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

it('retries a failed reconciliation read without resending an acknowledged write',async()=>{
 let reads=0,writes=0;
 const send=vi.fn(async(path)=>{
  if(path==='api/v1/health/nutrilist/a'){writes++;return {data:{uuid:'a',version:2},versions:{a:2}};}
  reads++;if(reads===1)throw new Error('refresh offline');
  return {items:[{uuid:'a',date:'2026-10-25',version:2,calories:100}]};
 });
 const wrapper=({children})=><HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
 const {result}=renderHook(useHealthOperations,{wrapper});
 act(()=>result.current.store.begin({id:'one',date:'2026-10-25',targetIds:['a'],request:{path:'api/v1/health/nutrilist/a',body:{operationId:'one'},method:'PUT'}}));
 await act(async()=>{await expect(result.current.execute('one')).rejects.toThrow('refresh offline');});
 expect(result.current.store.isReserved(['a'])).toBe(true);
 await act(()=>result.current.retry('one'));
 expect(writes).toBe(1);expect(reads).toBe(2);
 expect(result.current.store.isReserved(['a'])).toBe(false);
});
