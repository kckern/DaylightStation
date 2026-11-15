import { describe, it, expect, vi } from 'vitest';
import { KnowledgeEntryScheduler } from './KnowledgeEntryScheduler.mjs';
import { MaintainKnowledgeBase } from './MaintainKnowledgeBase.mjs';
import { memoryStore,evidenceSource,fakeClock,nextId,evidence,proposal,AS_OF,TZ } from './fixtures.testHelpers.mjs';
function setup({length=200,realMaintenance=false}={}) {
 const time=fakeClock(),store=memoryStore(),sources=evidenceSource([evidence({content:'I will contact Sample on Monday. '.padEnd(length,'x')})]);
 const id=nextId(),extractor={extract:vi.fn(async()=>({proposals:[proposal()],modelVersion:'sample'}))};
 const maintenance=realMaintenance?new MaintainKnowledgeBase({enabled:true,store,evidence:sources,extractor,clock:time.now,userTimezone:()=>TZ,nextId:id,logger:{warn(){}}}):{execute:vi.fn(async()=>({status:'completed'}))};
 const sendAck=vi.fn(async()=>({messageId:'ack-1'})),deliverEcho=vi.fn(async()=>({messageId:'echo-1'}));
 const deps={enabled:true,store,evidence:sources,maintenance,scheduler:time.scheduler,clock:time.now,userTimezone:()=>TZ,nextId:id,sendAck,deliverEcho,logger:{warn(){}}};
 const service=new KnowledgeEntryScheduler(deps);
 return {service,time,store,sources,maintenance,sendAck,deliverEcho,extractor,deps};
}
const saved=(sourceId='source-1',extra={})=>({username:'sample',sourceId,asOf:AS_OF,...extra});
describe('durable knowledge entry debounce',()=>{
 it('ignores199 characters, schedules200, and schedules a short attributed answer',async()=>{
  const short=setup({length:199});expect((await short.service.onEntrySaved(saved())).scheduled).toBe(false);expect(short.time.jobs).toHaveLength(0);
  const exact=setup();expect((await exact.service.onEntrySaved(saved())).scheduled).toBe(true);
  const answer=setup({length:4});expect((await answer.service.onEntrySaved(saved('source-1',{attributedAnswer:true}))).scheduled).toBe(true);
 });
 it('moves t0 deadline to t29 when another message arrives at t14',async()=>{
  const {service,time,sources,maintenance}=setup();await service.onEntrySaved(saved());await time.advance(14*60000);
  sources.rows.push(evidence({sourceId:'source-2',ref:'journalist:msg:source-2',at:time.now(),localDate:'2026-11-03',content:'x'.repeat(200)}));
  await service.onEntrySaved(saved('source-2',{asOf:time.now()}));await time.advance(60000);expect(maintenance.execute).not.toHaveBeenCalled();
  await time.advance(14*60000);expect(maintenance.execute).toHaveBeenCalledTimes(1);
  expect(maintenance.execute).toHaveBeenCalledWith({username:'sample',trigger:'post-entry',asOf:AS_OF+29*60000});
 });
 it('restores the durable deadline once after restart without extending it',async()=>{
  const original=setup();await original.service.onEntrySaved(saved());await original.service.dispose();await original.time.advance(14*60000);
  const restarted=new KnowledgeEntryScheduler(original.deps);await restarted.restore({username:'sample'});await original.time.advance(60000);
  expect(original.maintenance.execute).toHaveBeenCalledTimes(1);
 });
 it('deduplicates the same source receipt and isolates different users',async()=>{
  const {service,store,sendAck}=setup({length:601});await service.onEntrySaved(saved());await service.onEntrySaved(saved());
  expect(sendAck).toHaveBeenCalledTimes(1);await service.onEntrySaved({...saved(),username:'other'});
  expect(sendAck).toHaveBeenCalledTimes(2);expect((await store.read({username:'other'})).state.pendingEntry.sourceIds).toEqual(['source-1']);
 });
 it('acknowledges601 characters immediately and sends a validated delayed echo after commit',async()=>{
  const {service,time,sendAck,deliverEcho,store}=setup({length:601,realMaintenance:true});
  expect(await service.onEntrySaved(saved())).toMatchObject({scheduled:true,suppressFollowUp:true});
  expect(sendAck).toHaveBeenCalledTimes(1);expect(deliverEcho).not.toHaveBeenCalled();
  await time.advance(15*60000);
  expect(deliverEcho).toHaveBeenCalledTimes(1);
  expect(deliverEcho.mock.calls[0][0].candidate).toMatchObject({objectIds:['loop.application-reply'],reviewCount:0});
  expect(Object.values((await store.read({username:'sample'})).state.echoCandidates)[0].status).toBe('delivered');
 });
 it('does not echo600 characters or invent follow-ups on extraction failure',async()=>{
  const exact=setup({length:600,realMaintenance:true});expect((await exact.service.onEntrySaved(saved())).suppressFollowUp).toBe(false);expect(exact.sendAck).not.toHaveBeenCalled();
  const failed=setup({length:601,realMaintenance:true});failed.extractor.extract.mockRejectedValue(Error('offline'));await failed.service.onEntrySaved(saved());await failed.time.advance(15*60000);
  expect(failed.deliverEcho).not.toHaveBeenCalled();expect(failed.extractor.extract).toHaveBeenCalledTimes(1);await failed.time.advance(3600000);expect(failed.extractor.extract).toHaveBeenCalledTimes(1);
 });
 it('does not resend an echo after delivery failure or an uncertain prepared delivery on restart',async()=>{
  const d=setup({length:601,realMaintenance:true});d.deliverEcho.mockRejectedValue(Error('send unknown'));await d.service.onEntrySaved(saved());await d.time.advance(15*60000);
  await d.service.restore({username:'sample'});expect(d.deliverEcho).toHaveBeenCalledTimes(1);
  const current=await d.store.read({username:'sample'});Object.values(current.state.echoCandidates)[0].status='prepared';d.store.users.set('sample',current);
  await new KnowledgeEntryScheduler(d.deps).restore({username:'sample'});expect(d.deliverEcho).toHaveBeenCalledTimes(1);
 });
 it('replays a ready echo after a crash between model commit and send without another model call',async()=>{
  const d=setup({length:601,realMaintenance:true});await d.service.onEntrySaved(saved());await d.service.dispose();
  await d.maintenance.execute({username:'sample',trigger:'post-entry',asOf:AS_OF+15*60000});
  const restarted=new KnowledgeEntryScheduler(d.deps);await restarted.restore({username:'sample'});
  expect(d.deliverEcho).toHaveBeenCalledTimes(1);expect(d.extractor.extract).toHaveBeenCalledTimes(1);
 });
 it('never schedules or writes when disabled or evidence is unverified',async()=>{
  const d=setup({length:601});const disabled=new KnowledgeEntryScheduler({...d.deps,enabled:false});
  expect((await disabled.onEntrySaved(saved())).scheduled).toBe(false);expect(d.store.commit).not.toHaveBeenCalled();
  d.sources.rows[0].verified=false;expect((await d.service.onEntrySaved(saved())).scheduled).toBe(false);expect(d.time.jobs).toHaveLength(0);
 });
});
it('keeps long-entry model suppression if acknowledgement bookkeeping fails',async()=>{
 const d=setup({length:601});const original=d.store.commit;let calls=0;
 d.store.commit=vi.fn(async args=>{calls++;if(calls===2)throw Error('ack receipt write failed');return original(args);});
 expect((await d.service.onEntrySaved(saved())).suppressFollowUp).toBe(true);expect(d.sendAck).toHaveBeenCalledTimes(1);
});
it('limits echoed normal loops to three and represents sensitive/person candidates by count',async()=>{
 const d=setup({length:601,realMaintenance:true});
 const proposals=Array.from({length:5},(_,i)=>proposal({id:'normal-'+i,target:'loop.sample-'+i}));
 proposals.push(proposal({id:'sensitive',target:'loop.private',fields:{title:'Private follow-up',sensitivity:'private'}}));
 proposals.push(proposal({id:'person',op:'propose_entity',target:'person.sample',fields:{kind:'person',name:'Sample'}}));
 d.extractor.extract.mockResolvedValue({proposals,modelVersion:'sample'});
 await d.service.onEntrySaved(saved());await d.time.advance(15*60000);
 const candidate=d.deliverEcho.mock.calls[0][0].candidate;
 expect(candidate.objectIds).toHaveLength(3);expect(candidate.objectIds.every(id=>id.startsWith('loop.'))).toBe(true);expect(candidate.reviewCount).toBe(2);
 expect((await d.store.read({username:'sample'})).objects['person.sample'].status).toBe('candidate');
});
it('continues a partially consumed bounded batch without losing the same-generation remainder',async()=>{
 const d=setup({length:200,realMaintenance:true});d.extractor.extract.mockResolvedValue({proposals:[],modelVersion:'sample'});
 for(let i=2;i<=101;i++)d.sources.rows.push(evidence({sourceId:'source-'+i,ref:'journalist:msg:source-'+i,content:d.sources.rows[0].content}));
 d.sources.readUserMessages.mockImplementation(async({after,through})=>{
  const seen=new Set(after.seen),messages=d.sources.rows.filter(row=>row.at<=through&&!seen.has(row.sourceId)).slice(0,100);
  return {messages,cursor:{since:after.since,seen:[...seen,...messages.map(row=>row.sourceId)]}};
 });
 for(let i=1;i<=101;i++)await d.service.onEntrySaved(saved('source-'+i));
 await d.time.advance(15*60000);
 expect(d.extractor.extract).toHaveBeenCalledTimes(2);
 expect((await d.store.read({username:'sample'})).state.cursor.seen).toHaveLength(101);
});
