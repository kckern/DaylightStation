import {describe,it,expect} from 'vitest';
import {TodoistWorkProvider} from './TodoistWorkProvider.mjs';
import {resolveWorkPolicy} from './WorkConfig.mjs';
import {AS_OF,todoTask} from '../../../../../tests/_lib/work/observations.mjs';
const config={work:{enabled:true,providers:{personal:{type:'todoist',accountId:'personal',authScope:'user',operations:['read']}},domains:{personal:{provider:'personal',containerId:'sample-project',role:'tasks',autoComplete:'linked_explicit'}},users:{sample:{}}}};
const policy=username=>resolveWorkPolicy({configuration:config,username,timezone:'America/Los_Angeles'});
function setup(snapshot,history={}){return new TodoistWorkProvider({loadCurrent:async()=>snapshot,loadHistory:async()=>history,resolvePolicy:policy,accountId:'personal'});}
const raw=()=>({accountId:'personal',observedAt:AS_OF,coverage:{complete:true,from:AS_OF-7*86400000,to:AS_OF,scope:{accountId:'personal',containerIds:['sample-project'],assigneeIds:null},reason:null},tasks:[todoTask()],containers:[{id:'sample-project',name:'Sample project'}]});
describe('read-only scoped Todoist work projection',()=>{
 it('retains unknown modification dates, stable version and personal recurrence',async()=>{
  const p=setup(raw()),r=await p.readSnapshot({username:'sample',asOf:AS_OF});expect(r.items).toHaveLength(1);expect(r.items[0]).toMatchObject({ref:{provider:'todoist',accountId:'personal',kind:'task',id:'9007199254740993123'},modifiedAt:null,status:{native:'open',category:'open'},due:{date:'2026-11-18',recurring:true}});
  const next=raw();next.observedAt+=60000;const r2=await setup(next).readSnapshot({username:'sample',asOf:AS_OF+60000});expect(r2.items[0].version).toBe(r.items[0].version);expect(r.items[0].createdAt).toBe(Date.parse('2021-04-20T11:26:56.521Z'));
 });
 it('does not expose another account/user or out-of-scope task',async()=>{
  const x=raw();x.tasks.push(todoTask({id:'other',project_id:'other-project'}));const p=setup(x);expect((await p.readSnapshot({username:'sample',asOf:AS_OF})).items).toHaveLength(1);expect((await p.readSnapshot({username:'other',asOf:AS_OF})).items).toEqual([]);expect(await p.getItem({username:'sample',ref:{provider:'todoist',accountId:'other',kind:'task',id:'9007199254740993123'},asOf:AS_OF})).toBeNull();
 });
 it('marks legacy/unscoped and stale snapshots unavailable rather than authorizing a mutation',async()=>{
  const old=raw();delete old.accountId;expect((await setup(old).readSnapshot({username:'sample',asOf:AS_OF})).coverage.complete).toBe(false);
  expect((await setup(raw()).readSnapshot({username:'sample',asOf:AS_OF+25*3600000})).coverage).toMatchObject({complete:false,reason:'stale_snapshot'});
  expect(setup(raw()).capabilities({username:'sample'})).toMatchObject({read:true,complete:false,create_task:false});
 });
});

it('only corroborates scoped provider occurrences and keeps legacy account ambiguity visible',async()=>{
 const completed=(accountId,occurredAt)=>({id:'9007199254740993123',accountId,projectId:'sample-project',action:'completed',occurredAt,occurrenceId:String(occurredAt),time:'07:00'});
 const events=[completed('personal',AS_OF-3600000),completed('personal',AS_OF-7200000),completed('other',AS_OF-1800000),completed(null,AS_OF-900000)];
 const result=await setup(raw(),{'2026-11-17':events}).readSnapshot({username:'sample',asOf:AS_OF});
 expect(result.events).toHaveLength(2);expect(new Set(result.events.map(e=>e.id)).size).toBe(2);expect(result.coverage).toMatchObject({complete:false,reason:'unscoped_history'});
});
it('does not let query input replace the configured reader or policy dependencies',async()=>{
 const forged=raw();forged.tasks[0].content='Forged source';
 const result=await setup(raw()).readSnapshot({username:'sample',asOf:AS_OF,loadCurrent:async()=>forged});
 expect(result.items[0].title).toBe('Contact Sample');
});
it('does not interpret a provider timestamp without a timezone using the server clock zone',async()=>{
 const source=raw();source.tasks[0].updated_at='2026-11-17T08:00:00';
 const result=await setup(source).readSnapshot({username:'sample',asOf:AS_OF});
 expect(result.items[0].modifiedAt).toBeNull();
});
it('coalesces identical source identities instead of showing the same task twice',async()=>{
 const source=raw();source.tasks.push(structuredClone(source.tasks[0]));
 const result=await setup(source).readSnapshot({username:'sample',asOf:AS_OF});expect(result.items).toHaveLength(1);
});
it('rejects conflicting versions of one task within a supposedly complete snapshot',async()=>{
 const source=raw();source.tasks.push({...source.tasks[0],content:'Conflicting title'});
 const result=await setup(source).readSnapshot({username:'sample',asOf:AS_OF});expect(result.coverage).toMatchObject({complete:false,reason:'inconsistent_snapshot'});
});
