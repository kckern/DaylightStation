import { it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HealthOperationsProvider, useHealthOperations } from './HealthOperationsProvider.jsx';
import { useFoodMutation } from './useFoodMutation.js';
it('rechecks locks at dispatch even when an editor was already open',async()=>{
 const rows=[{uuid:'a',date:'2026-10-25',version:1},{uuid:'b',date:'2026-10-25',version:1}];
 const pending=[];
 const send=vi.fn((path,body)=>new Promise(resolve=>pending.push({path,body,resolve})));
 const wrapper=({children})=><HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
 const {result}=renderHook(()=>useFoodMutation(rows),{wrapper});
 let a,b;
 act(()=>{a=result.current('api/v1/health/nutrilist/a',{operationId:'first'},'PUT');});
 await expect(result.current('api/v1/health/nutrilist/a',{operationId:'overlap'},'PUT')).rejects.toThrow(/saving/);
 act(()=>{b=result.current('api/v1/health/nutrilist/b',{operationId:'second'},'PUT');});
 expect(send).toHaveBeenCalledTimes(2);
 await act(async()=>{pending[1].resolve({data:{...rows[1],version:2}});await b;pending[0].resolve({data:{...rows[0],version:2}});await a;});
});

it('reserves proposed group members instead of all foods in a meal',async()=>{
 const rows=['a','b','c'].map(uuid=>({uuid,date:'2026-10-25',version:1}));let finish;
 const send=()=>new Promise(resolve=>{finish=resolve;});
 const wrapper=({children})=><HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
 const {result}=renderHook(()=>({api:useFoodMutation(rows),session:useHealthOperations()}),{wrapper});
 let request;
 act(()=>{request=result.current.api('api/v1/health/nutrition/meal-command',{action:'groups',date:'2026-10-25',selectedIds:['a','b','c'],groups:[{name:'Dish',selectedIds:['a','b']}],operationId:'groups'},'POST');});
 expect(result.current.session.store.isReserved(['a'])).toBe(true);
 expect(result.current.session.store.isReserved(['c'])).toBe(false);
 await act(async()=>{finish({committed:true,items:rows.slice(0,2)});await request;});
});

const session=send=>({children})=><HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;

it('treats a day instruction as a capture that carries the day\'s versions',async()=>{
 const rows=[{uuid:'a',date:'2026-10-25',version:4},{uuid:'b',date:'2026-10-24',version:9}];
 let finish;const send=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>({api:useFoodMutation(rows),session:useHealthOperations()}),{wrapper:session(send)});
 let request;
 act(()=>{request=result.current.api('api/v1/health/nutrition/day-input',{type:'text',content:'eggs',date:'2026-10-25',operationId:'day'},'POST');});
 expect(send.mock.calls[0][1]).toMatchObject({operationId:'day',expectedVersions:{a:4}});
 expect(send.mock.calls[0][1].expectedVersions).not.toHaveProperty('b');
 expect(result.current.session.snapshot.operations.get('day')).toMatchObject({kind:'mutation',date:'2026-10-25'});
 await act(async()=>{finish({committed:true,outcome:'committed',kind:'logged',items:[{uuid:'c',date:'2026-10-25',version:1}]});await request;});
});

it('reserves a moved dish and its parts, and names a refusal before anything is sent',async()=>{
 const rows=[{uuid:'g',id:'g1',kind:'group',date:'2026-10-25'},{uuid:'c',parentId:'g1',date:'2026-10-25'},{uuid:'x',date:'2026-10-25'}];
 let finish;const send=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>({api:useFoodMutation(rows),session:useHealthOperations()}),{wrapper:session(send)});
 const move=(selectedIds,operationId)=>['api/v1/health/nutrition/foods-move',{date:'2026-10-25',selectedIds,expectedVersions:Object.fromEntries(selectedIds.flatMap(id=>id==='g'?['g','c']:[id]).map(id=>[id,1])),toMeal:'night',operationId},'POST'];
 expect(result.current.api.refusal(...move(['g'],'one'))).toBeNull();
 let request;
 act(()=>{request=result.current.api(...move(['g'],'one'));});
 expect(result.current.session.store.isReserved(['c'])).toBe(true);
 expect(result.current.session.store.isReserved(['x'])).toBe(false);
 expect(result.current.api.refusal(...move(['g'],'two'))).toEqual(expect.any(String));
 expect(result.current.api.refusal(...move(['x'],'three'))).toBeNull();
 await act(async()=>{finish({committed:true,items:rows.slice(0,2).map(row=>({...row,version:2}))});await request;});
});

it('releases only an operation that a server definitely refused',async()=>{
 const rows=[{uuid:'a',date:'2026-10-25',version:1}];
 const send=vi.fn(async()=>{throw Object.assign(new Error('no'),{status:409});});
 const {result}=renderHook(()=>({api:useFoodMutation(rows),session:useHealthOperations()}),{wrapper:session(send)});
 await act(async()=>{await expect(result.current.api('api/v1/health/nutrition/foods-move',{date:'2026-10-25',selectedIds:['a'],expectedVersions:{a:1},toMeal:'night',operationId:'one'},'POST')).rejects.toThrow('no');});
 expect(result.current.session.store.isReserved(['a'])).toBe(true);
 act(()=>result.current.api.release('one'));
 expect(result.current.session.store.isReserved(['a'])).toBe(false);
});

it('reserves only the rows a food move carries',async()=>{
 const rows=[{uuid:'old',kind:'group',date:'2026-10-24'},{uuid:'loose',parentId:'old',date:'2026-10-25'},{uuid:'gone-link',parentId:'missing',date:'2026-10-25'},
  {uuid:'g',kind:'group',date:'2026-10-25'},{uuid:'c',parentId:'g',date:'2026-10-25'},{uuid:'far',parentId:'g',date:'2026-10-24'}];
 let finish;const send=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>({api:useFoodMutation(rows),session:useHealthOperations()}),{wrapper:session(send)});
 let request;
 act(()=>{request=result.current.api('api/v1/health/nutrition/foods-move',{date:'2026-10-25',selectedIds:['loose','gone-link','g'],expectedVersions:{loose:1,'gone-link':1,g:1,c:1},toMeal:'night',operationId:'one'},'POST');});
 expect(result.current.session.snapshot.operations.get('one').targetIds).toEqual(['c','g','gone-link','loose']);
 await act(async()=>{finish({committed:true,items:['loose','gone-link','g','c'].map(uuid=>({uuid,date:'2026-10-25',version:2}))});await request;});
 expect(send).toHaveBeenCalledTimes(1);
});

it('restores barcode Undo scope so the original food stays locked during Undo', async () => {
 const date = '2026-10-25';
 const receiptKey = 'daylight.health.barcode-receipts:u:barcode-receipt';
 const reversedReceiptKey = 'daylight.health.barcode-receipts:u:reversed-receipt';
 const receipt = {
  id: 'barcode-receipt', userId: 'u', kind: 'barcode-commit', date, bucket: 'evening', startedAt: 1,
  receipt: { entryId: 'egg', undoToken: 'undo-token' },
 };
 localStorage.setItem(receiptKey, JSON.stringify(receipt));
 localStorage.setItem(reversedReceiptKey, JSON.stringify({
  id: 'reversed-receipt', userId: 'u', kind: 'barcode-commit', date, bucket: 'morning', startedAt: 2,
  reversed: true, receipt: { entryId: 'other', undoToken: 'already-undone' },
 }));
 const rows = [
  { uuid: 'egg', date, mealTime: 'evening', version: 1 },
  { uuid: 'other', date, mealTime: 'evening', version: 1 },
 ];
 let finishEdit;
 let finishUndo;
 let editFinished = false;
 const send = vi.fn((path) => {
  if (path.endsWith('/meal-undo')) {
   if (editFinished) return new Promise(resolve => { finishUndo = resolve; });
   return Promise.resolve({ committed: true, removedIds: ['egg'] });
  }
  return new Promise(resolve => { finishEdit = resolve; });
 });
 const { result } = renderHook(() => ({ api: useFoodMutation(rows), session: useHealthOperations() }), {
  wrapper: session(send),
 });

 try {
  expect(result.current.session.undoScopes.has('already-undone')).toBe(false);
  let edit;
  act(() => { edit = result.current.api('api/v1/health/nutrilist/egg', { date, operationId: 'edit-egg' }, 'PUT'); });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
   await expect(result.current.api('api/v1/health/nutrition/meal-undo', {
    undoToken: 'undo-token', operationId: 'undo-egg',
   }, 'POST')).rejects.toThrow(/already saving/);
  });
  expect(send).toHaveBeenCalledTimes(1);

  editFinished = true;
  await act(async () => {
   finishEdit({ committed: true, items: [{ ...rows[0], version: 2 }] });
   await edit;
  });

  let undo;
  act(() => { undo = result.current.api('api/v1/health/nutrition/meal-undo', {
   undoToken: 'undo-token', operationId: 'undo-egg',
  }, 'POST'); });
  expect(result.current.session.snapshot.operations.get('undo-egg')).toMatchObject({
   date, bucket: 'evening', targetIds: ['egg'],
   request: { path: 'api/v1/health/nutrition/meal-undo', body: { undoToken: 'undo-token', operationId: 'undo-egg' }, method: 'POST' },
  });
  expect(result.current.session.store.isReserved(['egg'])).toBe(true);
  expect(result.current.session.store.isReserved(['other'])).toBe(false);
  expect(send.mock.calls).toHaveLength(2);

  await act(async () => {
   finishUndo({ committed: true, removedIds: ['egg'], date });
   await undo;
  });
 } finally {
  localStorage.removeItem(receiptKey);
  localStorage.removeItem(reversedReceiptKey);
 }
});
