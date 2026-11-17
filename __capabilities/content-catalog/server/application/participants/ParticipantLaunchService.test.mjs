import {it,expect} from 'vitest';
import {ParticipantLaunchService} from './ParticipantLaunchService.mjs';
import {ParticipantConsumerRegistry} from './ParticipantConsumerRegistry.mjs';
const participant={key:'a',participant_id:'anon:p:a',identity:{kind:'anonymous',scope_id:'p',slot_id:'a'},display:{name:'Saved',avatar:null}};
it('inspects without retention and rejects stale confirmation before admission',async()=>{
 let retained=0,writes=0; const consumer={id:'fake',version:1,targets:[{action:'display',kind:'content',source:'fake',capability:'display'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:10,selectorSupport:['all','explicit']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'setup/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'required'}),retainPrepared:async()=>{retained++},begin:async()=>{throw Error('not reached')}};
 const target={kind:'content',source:'fake',capabilities:{display:{participantConsumer:{id:'fake',version:1}}}};
 const registry=new ParticipantConsumerRegistry(); registry.register({consumer});
 const source={scope:{provider:'agenda',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'display',consumer:{id:'fake',version:1},settings:{},provenance:{}};
 const store={inspect:async(k,cb)=>cb([]),reserve:async(i,cb)=>{const x=await cb([]);writes++;return x}};
 const provider={id:'agenda',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source};
 const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async x=>x.target,logger:{info(){}}});
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'};
 const inspected=await service.inspect({ref,action:'display',viewer:{}}); expect(inspected).toMatchObject({ready:true,confirmation:'required'}); expect(retained).toBe(0);expect(writes).toBe(0);
 await expect(service.begin({ref,action:'display',requestId:'r',intent:'new',viewer:{}})).rejects.toMatchObject({code:'setup_conflict'});
 await expect(service.begin({ref,action:'display',requestId:'r',intent:'new',expectedSetupHash:'wrong',viewer:{}})).rejects.toMatchObject({code:'setup_conflict'});
 expect(retained).toBe(0);expect(writes).toBe(0);
});

it('uses an authorized direct optional consumer without admitting a receipt when no default exists',async()=>{
 let writes=0,authorizations=0;
 const target={kind:'app',appId:'direct',participantConsumer:{id:'direct',version:1}};
 const store={reserve:async(_input,build)=>{const value=await build([]);if(value.kind!=='passthrough') writes++;return value;}};
 const consumer={id:'direct',version:1,targets:[{action:'open',kind:'app',appId:'direct'}],describe:()=>({participantRequirement:'optional',minParticipants:1,maxParticipants:10,selectorSupport:['all']}),prepareSetup:async()=>{throw Error('unexpected preparation')},begin:async()=>{throw Error('unexpected execution')}};
 const registry=new ParticipantConsumerRegistry(); registry.register({consumer,authorizeDirectAccess:async()=>{authorizations++;return {store,scope_key:'direct'};}});
 const service=new ParticipantLaunchService({registry,providers:[],resolveDirectTarget:async({target})=>target,logger:{info(){}}});
 const result=await service.begin({target,action:'open',requestId:'r',intent:'new',viewer:{}});
 expect(result).toEqual({schema:'participant-launch-result/v1',kind:'passthrough',action:'open',target}); expect(writes).toBe(0);expect(authorizations).toBe(1);
});

it('resumes an exact old direct consumer without live target resolution',async()=>{
 let reads=0,live=0,oldResumes=0;
 const target={kind:'app',appId:'direct',participantConsumer:{id:'direct',version:1}};
 const {hashValue}=await import('./ParticipantSetupResolver.mjs');
 const base={schema:'participant-launch-snapshot/v1',launch_id:'launch',consumer:{id:'direct',version:1},action:'open',target,participant_context:null,prepared:{},setup_hash:'setup'};
 const snapshot={...base,snapshot_hash:hashValue(base)};
 const ready={schema:'participant-launch-result/v1',kind:'ready',launch_id:'launch',consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:null,output:{schema:'old/v1',data:{}}};
 const store={readRetained:async()=>{reads++;return {snapshot,receipt:{launch_id:'launch',snapshot_hash:snapshot.snapshot_hash,result:ready}};}};
 const make=version=>({id:'direct',version,targets:[{action:'open',kind:'app',appId:'direct'}],describe:()=>({}),prepareSetup:async()=>({}),begin:async()=>({}),findResumable:async()=>[],resume:async()=>{if(version===1)oldResumes++;return ready;}});
 const registry=new ParticipantConsumerRegistry(); registry.register({consumer:make(1),retainedOnly:true,authorizeDirectAccess:async()=>({store,scope_key:'scope'})});registry.register({consumer:make(2)});
 const service=new ParticipantLaunchService({registry,providers:[],resolveDirectTarget:async()=>{live++;throw Error('must not resolve')},logger:{info(){}}});
 expect(await service.resume({target,action:'open',launchId:'launch',viewer:{}})).toEqual(ready);expect(reads).toBe(1);expect(live).toBe(0);expect(oldResumes).toBe(1);
 await expect(service.resume({target:{...target,appId:'forged'},action:'open',launchId:'launch',viewer:{}})).rejects.toThrow();expect(reads).toBe(1);
});

it('rejects a retained navigation target that is an external URL',async()=>{
 const {hashValue}=await import('./ParticipantSetupResolver.mjs'); const target={kind:'app',appId:'x',participantConsumer:{id:'x',version:1}};
 const base={schema:'participant-launch-snapshot/v1',launch_id:'a',consumer:{id:'x',version:1},action:'open',target,participant_context:null,prepared:{},setup_hash:'x'};const snapshot={...base,snapshot_hash:hashValue(base)};
 const ready={schema:'participant-launch-result/v1',kind:'ready',launch_id:'a',consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:null,output:{schema:'x/v1',data:{}}};
 let destination='https://example.test'; const store={readRetained:async()=>({snapshot,receipt:{launch_id:'a',snapshot_hash:snapshot.snapshot_hash,result:ready},return_to:{kind:'content',content_id:destination}})};
 const consumer={id:'x',version:1,targets:[{action:'open',kind:'app',appId:'x'}],describe:()=>({}),prepareSetup:async()=>({}),begin:async()=>({}),findResumable:async()=>[],resume:async()=>ready};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer,authorizeDirectAccess:async()=>({store,scope_key:'x'})});
 const service=new ParticipantLaunchService({registry,resolveDirectTarget:async()=>target,logger:{info(){}}});
 await expect(service.resume({target,action:'open',launchId:'a',viewer:{}})).rejects.toMatchObject({code:'invalid_return_target'});
 destination='https:example.test';await expect(service.resume({target,action:'open',launchId:'a',viewer:{}})).rejects.toMatchObject({code:'invalid_return_target'});
 destination='javascript:alert';await expect(service.resume({target,action:'open',launchId:'a',viewer:{}})).rejects.toMatchObject({code:'invalid_return_target'});
});

it('fails closed when the exact retained consumer version is unavailable',async()=>{
 const {hashValue}=await import('./ParticipantSetupResolver.mjs');
 const base={schema:'participant-launch-snapshot/v1',launch_id:'a',consumer:{id:'missing',version:1},action:'open',target:{kind:'app'},participant_context:null,prepared:{},setup_hash:'x'};
 const snapshot={...base,snapshot_hash:hashValue(base)};const store={readRetained:async()=>({snapshot,receipt:{launch_id:'a',snapshot_hash:snapshot.snapshot_hash,result:{kind:'ready'}}})};
 const provider={id:'agenda',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>{throw Error('must not resolve')}};
 const registry=new ParticipantConsumerRegistry();const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async()=>{throw Error('must not resolve')},logger:{info(){}}});
 await expect(service.resume({ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'ref'},action:'open',launchId:'a',viewer:{}})).rejects.toMatchObject({code:'consumer_version_unavailable'});
});

it('does not admit when retention fails or changes the inspected setup',async()=>{
 let writes=0,mutate=false;
 const target={kind:'app',appId:'x',participantConsumer:{id:'x',version:1}};
 const consumer={id:'x',version:1,targets:[{action:'open',kind:'app',appId:'x'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'x',version:1},setup:{schema:'x/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),retainPrepared:async({prepared})=>{if(mutate)prepared.setup.data.changed=true;else throw Object.assign(Error('pin failed'),{code:'prepared_artifact_unavailable'});},begin:async()=>{throw Error('unexpected')}};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});
 const source={scope:{provider:'agenda',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'x',version:1},settings:{}};
 const store={reserve:async(_,build)=>{const result=await build([]);writes++;return result}};
 const service=new ParticipantLaunchService({registry,providers:[{id:'agenda',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source}],resolveDirectTarget:async()=>target,logger:{info(){}}});
 const input={ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'},action:'open',requestId:'r',intent:'new',viewer:{}};
 await expect(service.begin(input)).rejects.toMatchObject({code:'prepared_artifact_unavailable'});mutate=true;
 await expect(service.begin(input)).rejects.toMatchObject({code:'prepared_artifact_unavailable'});expect(writes).toBe(0);
});

it('passes only receipts for the exact consumer version to resumable discovery',async()=>{
 let observed;
 const target={kind:'app',appId:'x',participantConsumer:{id:'x',version:2}};
 const consumer={id:'x',version:2,targets:[{action:'open',kind:'app',appId:'x'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'x',version:2},setup:{schema:'x/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),begin:async()=>({}),findResumable:async({receipts})=>{observed=receipts;return []},resume:async()=>({})};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});const source={scope:{provider:'agenda',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'x',version:2},settings:{}};
 const receipts=[{launch_id:'old',consumer:{id:'x',version:1}},{launch_id:'current',consumer:{id:'x',version:2}}];const store={inspect:async(_,build)=>build(receipts)};
 const service=new ParticipantLaunchService({registry,providers:[{id:'agenda',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source}],resolveDirectTarget:async()=>target,logger:{info(){}}});
 await service.inspect({ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'},action:'open',viewer:{}});expect(observed).toEqual([receipts[1]]);
});

it('retains the declared returnTo of a contract-only non-Agenda provider for begin and resume',async()=>{
 const {hashValue}=await import('./ParticipantSetupResolver.mjs');
 const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};
 const destination={kind:'content',content_id:'collection:week/plan',item_uid:'item'};const expectedDestination=structuredClone(destination);
 const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),begin:async({snapshot})=>({schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'fake/v1',data:{}}}),findResumable:async()=>[],resume:async({receipt})=>receipt.result};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});let saved;
 const store={reserve:async(_,build)=>{const value=await build([]);const base={...value.snapshot,launch_id:'one'};saved={snapshot:{...base,snapshot_hash:hashValue(base)},provenance:value.provenance};return {kind:'reserved',snapshot:saved.snapshot,executionKey:'key'};},complete:async({result})=>{saved.result=result;return result;},readRetained:async()=>({snapshot:saved.snapshot,receipt:{launch_id:'one',snapshot_hash:saved.snapshot.snapshot_hash,result:saved.result},return_to:saved.provenance.return_to})};
 const source={sourceRevision:1,scope:{provider:'other',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'fake',version:1},settings:{},returnTo:destination};
 const provider={id:'other',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source};
 const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async()=>target,logger:{info(){}}});const ref={schema:'participant-launch-ref/v1',provider:'other',ref:'opaque'};
 const started=await service.begin({ref,action:'open',requestId:'one',intent:'new',viewer:{}});
 expect(saved.provenance.return_to).toEqual(expectedDestination);expect(started.return_to).toEqual(expectedDestination);
 destination.content_id='collection:changed';
 expect((await service.resume({ref,action:'open',launchId:'one',viewer:{}})).return_to).toEqual(expectedDestination);
 source.returnTo=expectedDestination;source.provenance={evidence:'owned',return_to:{kind:'content',content_id:'collection:other'}};
 const second=await service.begin({ref,action:'open',requestId:'two',intent:'new',viewer:{}});
 expect(saved.provenance).toEqual({evidence:'owned',return_to:expectedDestination,execution_metadata:{schema:'participant-execution-metadata/v1',source_ref:ref,return_to:expectedDestination}});expect(second.return_to).toEqual(expectedDestination);
});

it('rejects an unsafe provider returnTo before retention or admission',async()=>{
 let pins=0,writes=0,preparations=0;
 const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};
 const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async()=>{preparations++;return {schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'};},retainPrepared:async()=>{pins++;},begin:async()=>{throw Error('unexpected');}};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});
 const store={reserve:async(_,build)=>{const result=await build([]);writes++;return result;}};
 const source={scope:{provider:'other',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'fake',version:1},settings:{},returnTo:{kind:'content',content_id:'https:evil'}};
 const service=new ParticipantLaunchService({registry,providers:[{id:'other',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source}],resolveDirectTarget:async()=>target,logger:{info(){}}});
 await expect(service.begin({ref:{schema:'participant-launch-ref/v1',provider:'other',ref:'opaque'},action:'open',requestId:'r',intent:'new',viewer:{}})).rejects.toMatchObject({code:'invalid_return_target'});
 expect(preparations).toBe(0);expect(pins).toBe(0);expect(writes).toBe(0);
});

it('rejects an unsafe fresh returnTo before aliasing an existing pending launch',async()=>{
 const {ParticipantSetupResolver}=await import('./ParticipantSetupResolver.mjs');
 let writes=0,retentions=0;
 const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};
 const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'none'}),retainPrepared:async()=>{retentions++;},begin:async()=>{throw Error('unexpected')}};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});
 const source={scope:{provider:'other',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'fake',version:1},settings:{},returnTo:{kind:'content',content_id:'https:evil'}};
 const {setupHash}=await new ParticipantSetupResolver({registry}).resolve({resolvedSource:source,viewer:{}});
 const store={reserve:async(_,build)=>{const result=await build([{launch_id:'pending',consumer:{id:'fake',version:1},setup_hash:setupHash}]);writes++;return result;}};
 const service=new ParticipantLaunchService({registry,providers:[{id:'other',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>source}],resolveDirectTarget:async()=>target,logger:{info(){}}});
 await expect(service.begin({ref:{schema:'participant-launch-ref/v1',provider:'other',ref:'opaque'},action:'open',requestId:'new',intent:'open',viewer:{}})).rejects.toMatchObject({code:'invalid_return_target'});
 expect(writes).toBe(0);expect(retentions).toBe(0);
});
