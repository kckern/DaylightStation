import {describe,it,expect} from 'vitest';
import {keyOf,validateWorkItem} from './workModel.mjs';
const ref={provider:'todoist',accountId:'personal',kind:'task',id:'9007199254740993123'};
const item=()=>({ref:{...ref},title:'Contact Sample',description:null,status:{native:'open',category:'open'},containerRef:{...ref,kind:'container',id:'sample-list'},ancestorRefs:[],createdAt:null,modifiedAt:null,completedAt:null,due:null,assigneeIds:[],url:null,observedAt:1794938400000,version:'source-v1'});
describe('work item identity and source chronology',()=>{
 it('keeps provider, account, kind and opaque string identity distinct',()=>{
  expect(keyOf(ref)).toBe('["todoist","personal","task","9007199254740993123"]');
  expect(new Set([ref,{...ref,provider:'clickup'},{...ref,accountId:'delivery'},{...ref,kind:'container'}].map(keyOf)).size).toBe(4);
 });
 it.each([null,{...ref,id:9007199254740992},{...ref,id:'../other'},{...ref,accountId:''},{...ref,kind:'file'},{...ref,provider:'todoist\nother'}])('rejects malformed or already rounded references: %j',value=>expect(()=>keyOf(value)).toThrow());
 it('keeps unknown source dates null rather than treating a refresh as activity',()=>{
  const value=item();expect(validateWorkItem(value)).toEqual(value);expect(value.createdAt).toBeNull();expect(value.modifiedAt).toBeNull();
 });
 it.each([
  {createdAt:'2026-11-17'}, {modifiedAt:NaN},{completedAt:-1},{observedAt:Infinity},
  {status:{native:'open',category:'fresh'}},{assigneeIds:[123]},{url:'javascript:alert(1)'},
  {containerRef:{...ref,kind:'container',accountId:'someone-else'}},{ancestorRefs:[{...ref,kind:'task'}]},
  {due:{date:'2026-02-30',at:null,recurring:false,occurrenceId:null}},
 ])('rejects unsafe or inconsistent item data: %j',patch=>expect(()=>validateWorkItem({...item(),...patch})).toThrow());
 it('preserves recurrence occurrence separately from the enduring task id',()=>{
  const value={...item(),due:{date:'2026-11-17',at:null,recurring:true,occurrenceId:'2026-11-17'}};
  expect(validateWorkItem(value).due.occurrenceId).toBe('2026-11-17');expect(value.ref.id).toBe('9007199254740993123');
 });
});
