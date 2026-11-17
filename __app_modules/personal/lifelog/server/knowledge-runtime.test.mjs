import {it,expect,vi} from 'vitest';
import {createKnowledgeRuntime} from './knowledge-runtime.mjs';
it('keeps an unconfigured boot inert without touching storage, scheduler or model',async()=>{
 const store={read:vi.fn(),commit:vi.fn(),close:vi.fn()},scheduler={after:vi.fn()},extractor={extract:vi.fn()};
 const runtime=createKnowledgeRuntime({configuration:{},store,scheduler,extractor});
 expect(runtime.followUps).toBeNull();expect(runtime.companion).toBeNull();expect(await runtime.start()).toMatchObject({status:'disabled'});await runtime.dispose();
 expect(store.read).not.toHaveBeenCalled();expect(store.close).not.toHaveBeenCalled();expect(scheduler.after).not.toHaveBeenCalled();expect(extractor.extract).not.toHaveBeenCalled();
});
it('refuses a synced production write flag on another host before touching storage',async()=>{
 const store={read:vi.fn(),commit:vi.fn()},runtime=createKnowledgeRuntime({configuration:{enabled:true,write:true,writer_env:'production',writer_host:'fixture-host'},environment:'production',hostId:'laptop',store});
 expect((await runtime.start()).status).toBe('disabled');expect(store.read).not.toHaveBeenCalled();
});
import crypto from 'node:crypto';
import {memoryStore,evidenceSource,fakeClock,AS_OF,TZ,proposal,evidence,nextId} from './application/knowledge/fixtures.testHelpers.mjs';
function activeSetup(){
 const time=fakeClock(AS_OF-86400000),store=memoryStore({health:{available:true,conflicted:false,recovering:false,lastSweepAt:null},state:{processedProposalIds:[],pendingReviews:[]}}),sources=evidenceSource([]),sends=[];
 const identity={username:'sample',senderId:'101',conversationId:'telegram:b42_c101'},secret='fixture-secret';
 const sourceId=crypto.createHash('sha256').update(JSON.stringify(['sample',identity.conversationId,'99'])).digest('hex');
 const extractor={extract:vi.fn(async()=>({proposals:[proposal({evidenceRef:'journalist:msg:'+sourceId,quote:'I will contact Sample today',fields:{title:'Contact Sample',kind_of:'status',dueText:'today',stakes:3}})],modelVersion:'fixture'}))};
 const options={configuration:{enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-host'},environment:'fixture-prod',hostId:'fixture-host',platform:'linux',usernames:['sample'],userTimezone:()=>TZ,identityForUser:()=>identity,identityForSender:id=>id==='101'?identity:null,webhookSecret:secret,store,evidence:sources,extractor,scheduler:time.scheduler,clock:time.now,nextId:nextId(),send:async input=>{sends.push(input);return {messageId:'200'};}};
 const runtime=createKnowledgeRuntime(options);
 const event=(type='text',callbackData)=>({platform:'telegram',type,platformUserId:'101',conversationId:identity.conversationId,messageId:type==='callback'?'200':'99',metadata:{senderId:'101',chatId:'101',chatType:'private'},payload:{callbackId:'reply-1',callbackData}});
 const principal=(type,raw)=>runtime.companion.capturePrincipal({event:event(type,raw),webhookSecret:secret});
 return {runtime,time,store,sources,extractor,sends,sourceId,principal,options,identity};
}
it('runs a verified entry through debounce, local due date, morning ACK and an idempotent tap',async()=>{
 const d=activeSetup();expect(await d.runtime.start()).toMatchObject({status:'started',users:1});
 const text='I will contact Sample today. '.padEnd(201,'x');
 d.sources.rows.push(evidence({sourceId:d.sourceId,ref:'journalist:msg:'+d.sourceId,senderId:'101',conversationId:d.identity.conversationId,messageId:'99',at:d.time.now(),localDate:'2026-11-02',content:text}));
 await d.runtime.companion.onEntrySaved({principal:d.principal('text'),message:{content:text},asOf:d.time.now()});
 await d.time.advance(15*60000);expect(d.extractor.extract).toHaveBeenCalledTimes(1);
 expect((await d.store.read({username:'sample'})).objects['loop.application-reply'].loop.due).toBe('2026-11-02');
 await d.time.advance(86400000-15*60000);
 const selected=await d.runtime.followUps.selectForMorning({username:'sample',askDate:'2026-11-03',asOf:d.time.now()});expect(selected.questions).toHaveLength(1);
 const delivery=await d.runtime.followUps.prepareDelivery({username:'sample',conversationId:d.identity.conversationId,selectionId:selected.selectionId,askDate:'2026-11-03',channel:'morning',questionIds:selected.questions.map(q=>q.id),asOf:d.time.now()});
 expect((await d.store.read({username:'sample'})).asks).toEqual([]);
 await d.runtime.followUps.recordDelivery({username:'sample',deliveryId:delivery.deliveryId,botMessageId:'200',asOf:d.time.now()});
 const raw=delivery.choices[0][0].callback_data,p=d.principal('callback',raw);
 expect(await d.runtime.companion.handleCallback({principal:p,callbackData:raw,asOf:d.time.now()})).toMatchObject({status:'applied'});
 expect(await d.runtime.companion.handleCallback({principal:p,callbackData:raw,asOf:d.time.now()})).toMatchObject({status:'already_applied'});
 expect((await d.store.read({username:'sample'})).objects['loop.application-reply'].status).toBe('answered');expect(d.extractor.extract).toHaveBeenCalledTimes(1);await d.runtime.dispose();
});
it('refuses attribution for a verified event with no durable matching journal evidence',async()=>{
 const d=activeSetup();await d.runtime.start();
 expect(await d.runtime.companion.onEntrySaved({principal:d.principal('text'),message:{content:'unpersisted'},asOf:d.time.now()})).toMatchObject({scheduled:false});
 expect((await d.store.read({username:'sample'})).state.attributedSources).toBeUndefined();await d.runtime.dispose();
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
it('builds production adapters lazily, initializes without backfill and closes the real writer lease',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-runtime-')),models=vi.fn(async()=>({proposals:[]}));
 const gateway={model:'fixture-model',scoped(){return this;},chatStructured:models};
 const identity={senderId:'101',conversationId:'telegram:b42_c101'};
 const configService={getHouseholdUsers:()=>['sample'],getUserProfile:()=>({timezone:TZ}),getUserHouseholdId:()=> 'household',getHouseholdTimezone:()=>TZ,getUserDir:()=>root};
 const runtime=createKnowledgeRuntime({configuration:{enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-host'},environment:'fixture-prod',hostId:'fixture-host',platform:'linux',configService,dataService:{user:{read:()=>({messages:[]})}},userIdentityService:{resolvePlatformId:()=>identity.senderId,resolveUsername:()=> 'sample'},telegramIdentityAdapter:{resolve:()=>({conversationIdString:identity.conversationId})},gateway,webhookSecret:'fixture-secret',send:async()=>({messageId:'200'}),scheduler:fakeClock().scheduler,clock:()=>AS_OF});
 try{expect(await runtime.start()).toMatchObject({status:'started',users:1});expect(models).not.toHaveBeenCalled();expect(fs.existsSync(path.join(root,'lifelog/knowledge/state.yml'))).toBe(true);}finally{await runtime.dispose();fs.rmSync(root,{recursive:true,force:true});}
});
it('recovers participation at the next sweep after a failed startup and does not duplicate timers on repeated start',async()=>{
 const d=activeSetup();d.store.recover.mockRejectedValueOnce(Error('temporarily unavailable'));
 expect(await d.runtime.start()).toMatchObject({users:0});await d.runtime.start();
 expect(d.time.jobs.filter(job=>!job.cancelled)).toHaveLength(2);
 await d.time.advance(20*3600000+30*60000);
 expect((await d.runtime.followUps.selectForMorning({username:'sample',askDate:'2026-11-03',asOf:d.time.now()})).mode).toBe('knowledge');
 await d.runtime.dispose();expect(d.time.jobs.filter(job=>!job.cancelled)).toHaveLength(0);
});
it('rejects direct companion operations after disposal even with a previously verified principal',async()=>{
 const d=activeSetup();await d.runtime.start();const p=d.principal('text');await d.runtime.dispose();
 await expect(d.runtime.companion.nextQuiz({principal:p,asOf:d.time.now()})).rejects.toThrow('KNOWLEDGE_UNAVAILABLE');
});
it('bounds shutdown and rejects a model result that arrives after its writer has closed',async()=>{
 const d=activeSetup();await d.runtime.start();let resolve;
 d.extractor.extract.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const content='I will contact Sample today. '.padEnd(201,'x');d.sources.rows.push(evidence({sourceId:d.sourceId,ref:'journalist:msg:'+d.sourceId,senderId:'101',conversationId:d.identity.conversationId,messageId:'99',at:d.time.now(),localDate:'2026-11-02',content}));
 await d.runtime.companion.onEntrySaved({principal:d.principal('text'),message:{content},asOf:d.time.now()});
 const extraction=d.time.advance(15*60000);await vi.waitFor(()=>expect(d.extractor.extract).toHaveBeenCalledTimes(1));
 const shutdown=d.runtime.dispose();await d.time.advance(5000);await shutdown;const before=(await d.store.read({username:'sample'})).revision;
 resolve({proposals:[proposal({evidenceRef:'journalist:msg:'+d.sourceId})],modelVersion:'fixture'});await extraction;
 expect((await d.store.read({username:'sample'})).revision).toBe(before);
});
it('does not initialize data after recovery finishes beyond the shutdown deadline',async()=>{
 const d=activeSetup();let release;d.store.recover.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const startup=d.runtime.start();await vi.waitFor(()=>expect(d.store.recover).toHaveBeenCalledTimes(1));
 const shutdown=d.runtime.dispose();await d.time.advance(5000);await shutdown;const before=d.store.commit.mock.calls.length;
 release();await startup;expect(d.store.commit.mock.calls.length).toBe(before);
});
import {GenerateMorningDebrief} from '../../journalist/server/application/usecases/GenerateMorningDebrief.mjs';
it.each(['read_failure','write_failure','conflict','stale'])('keeps the ordinary debrief working when KB is unavailable: %s',async failure=>{
 const d=activeSetup();await d.runtime.start();const before=d.store.commit.mock.calls.length;
 if(failure==='read_failure')d.store.read.mockRejectedValueOnce(Error('disk unavailable'));
 else if(failure==='write_failure')d.store.commit.mockRejectedValueOnce(Error('disk full'));
 else if(failure==='conflict')d.store.users.get('sample').health.conflicted=true;
 else d.store.users.get('sample').health.lastSweepAt=d.time.now()-36*3600000-1;
 const generator=new GenerateMorningDebrief({followUpSource:d.runtime.followUps,clock:d.time.now,userTimezone:()=>TZ,lifelogAggregator:{aggregate:async()=>({_meta:{date:'2026-11-01',hasEnoughData:true,sources:['calendar']},summaryText:'Activity recorded'})},aiGateway:{chat:async()=> 'HOOK: Activity recorded\nWhat happened at the activity?'},logger:{info(){},warn(){},error(){}}});
 const result=await generator.execute({username:'sample',date:'2026-11-01',askDate:'2026-11-02',asOf:d.time.now()});
 expect(result.success).toBe(true);expect(result.summary).toBe('What happened at the activity?');expect(result.knowledgeSelection).toBeUndefined();expect(d.store.commit.mock.calls.length).toBe(before+(failure==='write_failure'?1:0));await d.runtime.dispose();
});
