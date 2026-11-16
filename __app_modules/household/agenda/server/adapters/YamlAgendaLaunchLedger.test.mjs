import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {YamlAgendaRepository} from './YamlAgendaRepository.mjs';
import {YamlAgendaLaunchLedger} from './YamlAgendaLaunchLedger.mjs';
it('persists an admitted request and aliases concurrent open reservations',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-ledger-')); try {
 const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});
 const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});
 const scopeKey=JSON.stringify(['home','family','plan','item','open']);
 const snap={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'content'},participant_context:null,prepared:{},setup_hash:'hash'};
 let builds=0; const first=await store.reserve({scopeKey,requestId:'one',requestDigest:'digest'},async()=>{builds++; return {snapshot:snap,provenance:{return_to:{kind:'content',content_id:'agenda:family/plans/plan',item_uid:'item'}}};});
 const retry=await store.reserve({scopeKey,requestId:'one',requestDigest:'digest'},()=>{throw Error('must not build')});
 expect(retry.snapshot).toEqual(first.snapshot); expect(builds).toBe(1);
 const alias=await store.reserve({scopeKey,requestId:'two',requestDigest:'other'},async()=>({reuse_launch_id:first.snapshot.launch_id,setup_hash:'hash'}));
 expect(alias.executionKey).toBe(first.executionKey);
 await expect(store.reserve({scopeKey,requestId:'one',requestDigest:'different'},()=>{})).rejects.toMatchObject({code:'idempotency_conflict'});
 const fresh=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});
 expect((await fresh.readRetained({scopeKey,launchId:first.snapshot.launch_id})).snapshot).toEqual(first.snapshot);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('keeps frozen inputs through concurrent open, failed creation, cancellation, new launch and explicit resume',async()=>{
 const {ParticipantLaunchService,ParticipantConsumerRegistry,hashValue}=await import('../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {AgendaParticipantContextProvider}=await import('../application/AgendaParticipantContextProvider.mjs');
 const {AgendaLaunchRefCodec}=await import('./AgendaLaunchRefCodec.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-launch-')); try {
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir}); const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});
  const target={kind:'app',appId:'fake',definitionId:'old',participantConsumer:{id:'fake',version:1}};
  const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:2,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[{id:'one',anonymous:true,display:{name:'Old',avatar:null}}],list:{sections:[{items:[{uid:'item',open:'fake'}]}]},activity_settings:{item:{action:'open',participants:{mode:'plan'},consumer:{id:'fake',version:1},settings:{}}}};
  repo.readPlan=async()=>({document:plan}); repo.readSeries=async()=>({document:{status:'active'}}); const codec=new AgendaLaunchRefCodec(); let resolveCount=0, beginCount=0, failOnce=true, capturedMetadata=[];
  const provider=new AgendaParticipantContextProvider({repository:repo,store,codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{},authorize:async({viewer})=>viewer.household==='home',resolveTarget:async()=>{resolveCount++;return target;}});
  const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:3,selectorSupport:['all','explicit']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),begin:async({snapshot,executionMetadata})=>{capturedMetadata.push(executionMetadata);beginCount++; if(failOnce){failOnce=false;throw Error('crash');} return {schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'fake-result/v1',data:{definition_id:snapshot.target.definitionId}},runtime_ref:{provider:'fake',id:snapshot.launch_id}};},findResumable:async()=>[],resume:async({receipt})=>receipt.result};
  const registry=new ParticipantConsumerRegistry();registry.register({consumer}); const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async({target})=>target,logger:{info(){}}});
  const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:2,action:'open',targetDigest:hashValue(target)})};
  const input={ref,action:'open',viewer:{household:'home'},intent:'open'};
  await expect(service.begin({...input,requestId:'a'})).rejects.toThrow('crash');
  const ready=await service.begin({...input,requestId:'b'}); expect(beginCount).toBe(2);
  expect(capturedMetadata).toEqual([0,1].map(()=>({schema:'participant-execution-metadata/v1',source_ref:ref,source_label:'Week of 2026-11-16',return_to:{kind:'content',content_id:'agenda:family/plans/plan',item_uid:'item'}})));
  const newerRef={schema:'participant-launch-ref/v1',provider:'agenda',ref:codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:3,action:'open',targetDigest:hashValue({...target,definitionId:'new'})})};
  const oldThroughNew=await service.resume({ref:newerRef,action:'open',launchId:ready.launch_id,viewer:{household:'home'}});expect(oldThroughNew.output.data.definition_id).toBe('old');
  plan.state='cancelled';plan.list.sections[0].items=[]; const before=resolveCount;
  const retry=await service.begin({...input,requestId:'a'});expect(retry.launch_id).toBe(ready.launch_id);expect(resolveCount).toBe(before);
  const resumed=await service.resume({ref,action:'open',launchId:ready.launch_id,viewer:{household:'home'}});expect(resumed.participant_context.participants[0].display.name).toBe('Old');expect(resumed.return_to.content_id).toBe('agenda:family/plans/plan');expect(resolveCount).toBe(before);
  await expect(service.begin({...input,requestId:'new',intent:'new'})).rejects.toMatchObject({code:'agenda_not_launchable'});
  await expect(service.resume({ref,action:'open',launchId:ready.launch_id,viewer:{household:'other'}})).rejects.toMatchObject({code:'authorization_denied'});
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('recovers an admitted direct attempt after its default disappears and passes through a fresh request',async()=>{
 const {ParticipantLaunchService,ParticipantConsumerRegistry}=await import('../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {createParticipantContext}=await import('../../../../../__capabilities/household-identity/portable/participants.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-direct-'));try {
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir}),store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir}),scopeKey=JSON.stringify(['home','series','plan','item','open']);
  const target={kind:'app',appId:'direct',participantConsumer:{id:'direct',version:1}};
  let context=await createParticipantContext({scope:{provider:'test',id:'scope',revision:1},participants:[{key:'a',participant_id:'anon:p:a',identity:{kind:'anonymous',scope_id:'p',slot_id:'a'},display:{name:'A',avatar:null}}]}); let live=0,crash=true;
  const consumer={id:'direct',version:1,targets:[{action:'open',kind:'app',appId:'direct'}],describe:()=>({participantRequirement:'optional',minParticipants:1,maxParticipants:10,selectorSupport:['all']}),resolveDefaultContext:async()=>context,prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'direct',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),begin:async({snapshot})=>{if(crash){crash=false;throw Error('crash');}return {schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'direct/v1',data:{}}};}};
  const registry=new ParticipantConsumerRegistry();registry.register({consumer,authorizeDirectAccess:async()=>({store,scope_key:scopeKey})});
  const service=new ParticipantLaunchService({registry,resolveDirectTarget:async()=>{live++;return target},logger:{info(){}}}); const input={target,action:'open',intent:'new',requestId:'same',viewer:{}};
  await expect(service.begin(input)).rejects.toThrow('crash');context=null;const oldLive=live;
  const recovered=await service.begin(input);expect(recovered.participant_context.participants[0].display.name).toBe('A');expect(live).toBe(oldLive);
  const fresh=await service.begin({...input,requestId:'fresh'});expect(fresh.kind).toBe('passthrough');
  const ledger=store.read(scopeKey);expect(Object.keys(ledger.launches)).toHaveLength(1);expect(Object.keys(ledger.requests)).toHaveLength(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('recovers an atomic admission when the writer reports failure after commit',async()=>{
 const {saveYamlToPathAtomic}=await import('#system/utils/FileIO.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-fault-'));try {
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});let calls=0;
  const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir,save:(...args)=>{saveYamlToPathAtomic(...args);calls++;throw Error('after commit');}});
  const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  const snapshot={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'hash'};
  await expect(store.reserve({scopeKey,requestId:'a',requestDigest:'digest'},async()=>({snapshot,provenance:{}}))).rejects.toThrow('after commit');
  const fresh=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const recovered=await fresh.reserve({scopeKey,requestId:'a',requestDigest:'digest'},()=>{throw Error('must not rebuild')});
  expect(calls).toBe(1);expect(recovered.snapshot.setup_hash).toBe('hash');expect(recovered.reused).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('rejects a retained return target outside the authorized activity',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-return-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});
  const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  const snapshot={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'hash'};
  const result=await store.reserve({scopeKey,requestId:'a',requestDigest:'a'},async()=>({snapshot,provenance:{return_to:{kind:'content',content_id:'https://example.test',item_uid:'item'}}}));
  await expect(store.readRetained({scopeKey,launchId:result.snapshot.launch_id})).rejects.toMatchObject({code:'invalid_document'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('aliases simultaneous opens to one frozen execution while new retains the older launch',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-concurrent-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  const snapshot={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'hash'};
  const open=id=>store.reserve({scopeKey,requestId:id,requestDigest:id},async receipts=>{const pending=receipts.find(r=>!r.result);return pending?{reuse_launch_id:pending.launch_id,setup_hash:'hash'}:{snapshot,provenance:{}}});
  const [one,two]=await Promise.all([open('a'),open('b')]);expect(one.snapshot.launch_id).toBe(two.snapshot.launch_id);expect(one.executionKey).toBe(two.executionKey);
  const next=await store.reserve({scopeKey,requestId:'new',requestDigest:'new'},async()=>({snapshot,provenance:{}}));expect(next.snapshot.launch_id).not.toBe(one.snapshot.launch_id);
  expect((await store.readRetained({scopeKey,launchId:one.snapshot.launch_id})).snapshot).toEqual(one.snapshot);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('makes simultaneous service opens use the same execution key and runtime',async()=>{
 const {ParticipantLaunchService,ParticipantConsumerRegistry}=await import('../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {createParticipantContext}=await import('../../../../../__capabilities/household-identity/portable/participants.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-opens-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  const target={kind:'app',appId:'direct',participantConsumer:{id:'direct',version:1}};
  const context=await createParticipantContext({scope:{provider:'test',id:'p',revision:1},participants:[{key:'a',participant_id:'anon:p:a',identity:{kind:'anonymous',scope_id:'p',slot_id:'a'},display:{name:'A',avatar:null}}]});
  const keys=[];let release;const gate=new Promise(resolve=>{release=resolve});let entered;const first=new Promise(resolve=>{entered=resolve});
  const consumer={id:'direct',version:1,targets:[{action:'open',kind:'app',appId:'direct'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:10,selectorSupport:['all']}),resolveDefaultContext:async()=>context,prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'direct',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),begin:async({snapshot,executionKey})=>{keys.push(executionKey);entered();await gate;return {schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'fake/v1',data:{}},runtime_ref:{provider:'fake',id:snapshot.launch_id}};}};
  const registry=new ParticipantConsumerRegistry();registry.register({consumer,authorizeDirectAccess:async()=>({store,scope_key:scopeKey})});const service=new ParticipantLaunchService({registry,resolveDirectTarget:async()=>target,logger:{info(){}}});
  const input={target,action:'open',intent:'open',viewer:{}};const a=service.begin({...input,requestId:'a'});await first;const b=service.begin({...input,requestId:'b'});
  while(keys.length<2) await new Promise(resolve=>setTimeout(resolve,1));release();const results=await Promise.all([a,b]);
  expect(keys[0]).toBe(keys[1]);expect(results[0].runtime_ref.id).toBe(results[1].runtime_ref.id);expect(Object.keys(store.read(scopeKey).launches)).toHaveLength(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('does not admit a launch when writing fails before commit',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-before-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir,save:()=>{throw Error('before commit')}});
  const scopeKey=JSON.stringify(['home','family','plan','item','open']);const snapshot={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'hash'};
  await expect(store.reserve({scopeKey,requestId:'a',requestDigest:'a'},async()=>({snapshot,provenance:{}}))).rejects.toThrow('before commit');
  expect(Object.keys(store.read(scopeKey).launches)).toHaveLength(0);expect(Object.keys(store.read(scopeKey).requests)).toHaveLength(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('reads inspection choices without creating a ledger file',async()=>{
 const {existsSync}=await import('node:fs');const dir=mkdtempSync(path.join(tmpdir(),'agenda-inspect-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  expect(await store.inspect(scopeKey,async receipts=>receipts)).toEqual([]);expect(existsSync(store.file(scopeKey))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('prefers the newest explicitly admitted launch while preserving older receipts',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-preferred-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  const snapshot={schema:'participant-launch-snapshot/v1',consumer:{id:'fake',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'hash'};
  const add=id=>store.reserve({scopeKey,requestId:id,requestDigest:id},async()=>({snapshot,provenance:{}}));
  const old=await add('old'),recent=await add('new');const choices=await store.inspect(scopeKey,async receipts=>receipts);
  expect(choices.map(choice=>choice.launch_id)).toEqual([recent.snapshot.launch_id,old.snapshot.launch_id]);
  expect((await store.readRetained({scopeKey,launchId:old.snapshot.launch_id})).snapshot).toEqual(old.snapshot);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('does not treat inherited object properties as retained launch IDs',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-inherited-'));try{
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const scopeKey=JSON.stringify(['home','family','plan','item','open']);
  expect(await store.readRetained({scopeKey,launchId:'__proto__'})).toBeNull();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
