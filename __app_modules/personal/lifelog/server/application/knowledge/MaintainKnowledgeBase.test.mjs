import { describe, it, expect, vi } from 'vitest';
import { MaintainKnowledgeBase } from './MaintainKnowledgeBase.mjs';
import { memoryStore,evidenceSource,AS_OF,TZ,evidence,proposal,nextId } from './fixtures.testHelpers.mjs';
const longMessage=()=>evidence({content:'I will contact Sample on Monday. '+ 'Detail. '.repeat(30)});
function setup(extra={}) {
 const store=memoryStore(),sources=evidenceSource([longMessage()]);
 const extractor={extract:vi.fn(async()=>({proposals:[proposal()],modelVersion:'sample-model'}))};
 const service=new MaintainKnowledgeBase({enabled:true,store,evidence:sources,extractor,clock:()=>AS_OF,userTimezone:()=>TZ,nextId:nextId(),logger:{warn:vi.fn(),info:vi.fn()},...extra});
 return {service,store,sources,extractor};
}
describe('knowledge maintenance',()=>{
 it('reserves before one model call, never holds a mutation lock during AI, then resolves the captured cursor',async()=>{
  const {service,store,extractor}=setup();
  extractor.extract.mockImplementation(async()=>{expect(store.inMutation).toBe(false);expect((await store.read({username:'sample'})).state.budgets['2026-11-03']).toBe(1);return {proposals:[proposal()],modelVersion:'sample'};});
  const result=await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});
  expect(result.status).toBe('completed');expect(result.acceptedIds).toEqual(['loop.application-reply']);
  expect((await store.read({username:'sample'})).state.cursor.seen).toEqual(['source-1']);
  expect(extractor.extract).toHaveBeenCalledTimes(1);
 });
 it('does not lose new equal-time or out-of-order messages arriving during model work',async()=>{
  const {service,store,sources,extractor}=setup();
  extractor.extract.mockImplementationOnce(async()=>{sources.rows.push(evidence({sourceId:'source-late',ref:'journalist:msg:source-late',content:longMessage().content,at:longMessage().at-1,localDate:'2026-11-02'}));return {proposals:[proposal()],modelVersion:'sample'};});
  await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});
  expect((await store.read({username:'sample'})).state.cursor.seen).toEqual(['source-1']);
  await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF+1});
  expect(extractor.extract.mock.calls[1][0].messages.map(m=>m.sourceId)).toEqual(['source-late']);
 });
 it('re-reads evidence and pins after AI; edited/missing original quotes cannot apply',async()=>{
  const {service,store,sources,extractor}=setup();
  extractor.extract.mockImplementationOnce(async()=>{sources.rows.length=0;return {proposals:[proposal()],modelVersion:'sample'};});
  const result=await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});
  expect(result.acceptedIds).toEqual([]);expect(result.rejected).toHaveLength(1);
  expect(Object.keys((await store.read({username:'sample'})).objects)).toEqual([]);
 });
 it('keeps failed extraction unconsumed and charges four failed attempts before refusing a fifth',async()=>{
  const {service,store,extractor}=setup();extractor.extract.mockRejectedValue(Error('model down'));
  for(let i=0;i<4;i++)expect((await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF+i})).status).toBe('failed');
  expect((await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF+5})).status).toBe('budget_exhausted');
  expect(extractor.extract).toHaveBeenCalledTimes(4);expect((await store.read({username:'sample'})).state.cursor.seen).toEqual([]);
 });
 it('does not advance the cursor or echo if applying a successful model result fails',async()=>{
  const {service,store}=setup();const original=store.commit;
  store.commit=vi.fn(async args=>{if(args.batch.events.some(e=>e.type==='proposal.accepted'))throw Error('disk unavailable');return original(args);});
  expect((await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF})).status).toBe('failed');
  expect((await store.read({username:'sample'})).state.cursor.seen).toEqual([]);
 });
 it('sweeps without a model when there is no qualifying new text, updating freshness only after commit',async()=>{
  const {service,store,extractor}=setup({evidence:evidenceSource([])});
  expect((await service.execute({username:'sample',trigger:'nightly',asOf:AS_OF})).status).toBe('completed');
  expect(extractor.extract).not.toHaveBeenCalled();expect((await store.read({username:'sample'})).state.lastSweepAt).toBe(AS_OF);
 });
 it('ignores short un-attributed entries but extracts a short attributed answer',async()=>{
  const source=evidenceSource([evidence({content:'Yes.'})]);const {service,store,extractor}=setup({evidence:source});
  const current=await store.read({username:'sample'});current.state.pendingEntry={sourceIds:['source-1'],answerIds:['source-1'],generation:'g',deadline:AS_OF};store.users.set('sample',current);
  await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});expect(extractor.extract).toHaveBeenCalledTimes(1);
 });
 it('initializes the live cursor at activation rather than backfilling old journals',async()=>{
  const store=memoryStore({state:{processedProposalIds:[],pendingReviews:[]}});const {service,extractor}=setup({store});
  await service.initialize({username:'sample',asOf:AS_OF});
  await service.execute({username:'sample',trigger:'nightly',asOf:AS_OF});
  expect(extractor.extract).not.toHaveBeenCalled();
 });
 it('deduplicates simultaneous same-user runs without blocking another user',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});const {service,extractor}=setup();
  extractor.extract.mockImplementationOnce(async()=>{await held;return {proposals:[proposal()],modelVersion:'sample'};});
  const first=service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});
  const second=service.execute({username:'sample',trigger:'nightly',asOf:AS_OF});
  expect((await service.execute({username:'other',trigger:'nightly',asOf:AS_OF})).status).toBe('completed');
  release();await Promise.all([first,second]);expect(extractor.extract).toHaveBeenCalledTimes(2);
 });
});
it('does not call AI when a stale reservation races with the fourth daily call',async()=>{
 const {service,store,extractor}=setup();const original=store.commit;let raced=false;
 store.commit=vi.fn(async args=>{
  if(!raced&&args.runId.endsWith(':budget')){raced=true;const current=await store.read({username:'sample'});current.state.budgets={'2026-11-03':4};current.revision++;store.users.set('sample',current);throw Object.assign(Error('stale'),{code:'STALE_KNOWLEDGE_REVISION'});}
  return original(args);
 });
 expect((await service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF})).status).toBe('budget_exhausted');
 expect(extractor.extract).not.toHaveBeenCalled();
});
it('does not mutate or call AI when disabled',async()=>{
 const d=setup({enabled:false});expect((await d.service.execute({username:'sample',trigger:'nightly',asOf:AS_OF})).status).toBe('disabled');expect(d.store.commit).not.toHaveBeenCalled();expect(d.store.recover).not.toHaveBeenCalled();expect(d.extractor.extract).not.toHaveBeenCalled();
});
it('rechecks a new status pin after AI before accepting closure',async()=>{
 const {loop}=await import('../../domain/knowledge/fixtures.testHelpers.mjs');
 const current=loop(),store=memoryStore({objects:{[current.id]:current}});const d=setup({store});
 d.extractor.extract.mockImplementationOnce(async()=>{const state=await store.read({username:'sample'});state.objects[current.id].pinned=['status'];state.revision++;store.users.set('sample',state);return {proposals:[proposal({op:'close_loop',fields:{status:'answered'}})],modelVersion:'sample'};});
 const result=await d.service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});
 expect(result.rejected[0].reason).toBe('pinned_field');expect((await store.read({username:'sample'})).objects[current.id].status).toBe('open');
});
it('stops a late model result during disposal before it can commit objects',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});const d=setup();
 d.extractor.extract.mockImplementation(async()=>{entered();await gate;return {proposals:[proposal()],modelVersion:'sample'};});
 const active=d.service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF});await started;const disposed=d.service.dispose();release();
 expect((await active).status).toBe('failed');await disposed;
 expect((await d.store.read({username:'sample'})).state.cursor.seen).toEqual([]);
});
it('honors a configured lower daily extraction cap',async()=>{
 const d=setup({maxRunsPerDay:1});d.extractor.extract.mockRejectedValue(Error('offline'));
 expect((await d.service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF})).status).toBe('failed');
 expect((await d.service.execute({username:'sample',trigger:'post-entry',asOf:AS_OF+1})).status).toBe('budget_exhausted');
 expect(d.extractor.extract).toHaveBeenCalledTimes(1);
});
