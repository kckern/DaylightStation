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

import {vi} from 'vitest';
const operations=['read','complete','reopen','create_task','update_task','delete_task','create_container','rename_container','archive_container','transition','archive_task'];
function commandsSetup(patch={}){
 const configuration=structuredClone(config);Object.assign(configuration.work,{write:true,writer_env:'test',writer_host:'test',providerWrites:true});configuration.work.providers.personal.operations=operations;
 const current=raw();Object.assign(current.tasks[0],patch);let task=structuredClone(current.tasks[0]);const writes=[];
 const client={request:vi.fn(async input=>{if(input.operation==='read')return task?{ok:true,status:200,data:structuredClone(task)}:{ok:false,status:404};writes.push(input);if(input.operation==='complete')task={...task,checked:true,completed_at:'2026-11-17T12:00:00Z'};if(input.operation==='reopen')task={...task,checked:false,completed_at:null};if(input.operation==='update_task')task={...task,content:input.payload.title};return {ok:true,status:200,data:{}};})};
 const verifyDispatch=vi.fn(async()=>true);
 const p=new TodoistWorkProvider({loadCurrent:async()=>current,loadHistory:async()=>({}),resolvePolicy:username=>resolveWorkPolicy({configuration,username,timezone:'America/Los_Angeles'}),accountId:'personal',client,verifyDispatch});
 const command=async(operation='complete',extra={})=>({id:'command-1',username:'sample',ref:(await p.readSnapshot({username:'sample',asOf:AS_OF})).items[0].ref,domainId:'personal',operation,payload:{},expectedVersion:(await p.readSnapshot({username:'sample',asOf:AS_OF})).items[0].version,sourceReceipt:'receipt-1',confirmationId:null,createdAt:AS_OF,...extra});
 return {p,client,writes,command,configuration,verifyDispatch,setTask:value=>{task=value;}};
}
describe('scoped Todoist commands',()=>{
 it('refetches and verifies completion without fabricating a journal event',async()=>{const x=commandsSetup({due:null});const result=await x.p.execute({username:'sample',command:await x.command(),asOf:AS_OF});expect(result.outcome).toBe('applied');expect(result.item.status.category).toBe('done');expect(result.observation).toBeNull();expect(x.writes).toHaveLength(1);});
 it.each(['transition','archive_task'])('denies unsupported %s without HTTP',async operation=>{const x=commandsSetup();expect((await x.p.execute({username:'sample',command:await x.command(operation),asOf:AS_OF})).outcome).toBe('denied');expect(x.client.request).not.toHaveBeenCalled();});
 it('intersects capabilities with configured operations',()=>{const x=commandsSetup();expect(x.p.capabilities({username:'sample'})).toMatchObject({read:true,complete:true,transition:false,archive_task:false});x.configuration.work.providers.personal.operations=['read'];expect(x.p.capabilities({username:'sample'}).complete).toBe(false);});
 it.each(['permission','destination','missing','changed','ref','authority','confirmation'])('does no write when %s changed or absent',async reason=>{const x=commandsSetup();const command=await x.command(reason==='confirmation'?'delete_task':'complete');if(reason==='permission')x.configuration.work.providers.personal.operations=['read'];if(reason==='destination')x.configuration.work.domains.personal.containerId='other';if(reason==='missing')x.setTask(null);if(reason==='changed')x.setTask(todoTask({content:'Changed'}));if(reason==='ref')command.ref.accountId='other';if(reason==='authority')x.verifyDispatch.mockResolvedValue(false);const r=await x.p.execute({username:'sample',command,asOf:AS_OF});expect(['denied','conflict']).toContain(r.outcome);expect(x.writes).toHaveLength(0);});
 it.each([[403,'denied'],[429,'failed'],[503,'uncertain']])('classifies %s without claiming success',async(status,outcome)=>{const x=commandsSetup();const request=x.client.request.getMockImplementation();x.client.request.mockImplementation(input=>input.operation==='read'?request(input):Promise.resolve({ok:false,status,retryAfter:AS_OF+30000}));expect(await x.p.execute({username:'sample',command:await x.command(),asOf:AS_OF})).toMatchObject({outcome});});
 it('does not retry a timed-out close or infer completion from advancing recurrence',async()=>{const x=commandsSetup();const command=await x.command();const request=x.client.request.getMockImplementation();x.client.request.mockImplementation(async input=>{if(input.operation==='read')return request(input);x.writes.push(input);x.setTask(todoTask({due:{date:'2026-11-19',is_recurring:true},completed_count:1}));throw new Error('timeout');});const result=await x.p.execute({username:'sample',command,asOf:AS_OF});expect(result.outcome).toBe('uncertain');expect(x.writes).toHaveLength(1);expect((await x.p.reconcile({username:'sample',command,asOf:AS_OF})).outcome).toBe('uncertain');expect(x.writes).toHaveLength(1);});
 it('checks dispatch authority again after the live read',async()=>{const x=commandsSetup();x.verifyDispatch.mockResolvedValueOnce(true).mockResolvedValue(false);expect((await x.p.execute({username:'sample',command:await x.command(),asOf:AS_OF})).outcome).toBe('denied');expect(x.writes).toHaveLength(0);});
});
