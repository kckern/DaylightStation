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
