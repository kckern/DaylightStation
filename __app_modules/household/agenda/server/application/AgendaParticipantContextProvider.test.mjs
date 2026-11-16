import {it,expect} from 'vitest';
import {AgendaParticipantContextProvider} from './AgendaParticipantContextProvider.mjs';
import {AgendaLaunchRefCodec} from '../adapters/AgendaLaunchRefCodec.mjs';
import {hashValue} from '../../../../../__capabilities/content-catalog/server/participant-launch.mjs';
it('authorizes retained access independently from live policy and preserves display snapshots',async()=>{
 const codec=new AgendaLaunchRefCodec(), target={kind:'content',source:'example',capabilities:{display:{participantConsumer:{id:'fake',version:1}}}};
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:2,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[{id:'one',person:{kind:'user',id:'user'},display:{name:'Saved',avatar:null}}],list:{sections:[{items:[{uid:'item',display:'x'}]}]},activity_settings:{item:{action:'display',participants:{mode:'plan'},consumer:{id:'fake',version:1},settings:{}}}};
 const repository={readPlan:async()=>({document:plan}),readSeries:async()=>({document:{status:'active'}})}; const store={};
 const provider=new AgendaParticipantContextProvider({repository,store,codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{resolve:async()=>({display:{name:'Changed'}})},authorize:async()=>true,resolveTarget:async()=>target});
 const ref=codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:2,action:'display',targetDigest:hashValue(target)});
 expect((await provider.authorizeAccess(ref,{action:'display',viewer:{}})).store).toBe(store);
 const source=await provider.resolve(ref,{viewer:{}}); expect(source.roster[0].display.name).toBe('Saved');
 plan.state='cancelled'; plan.list.sections[0].items=[];
 expect((await provider.authorizeAccess(ref,{action:'display',viewer:{}})).store).toBe(store);
 await expect(provider.resolve(ref,{viewer:{}})).rejects.toThrow();
});

it('allows the same source preparation for an authorized draft without launch policy',async()=>{
 const target={kind:'content',source:'fake',capabilities:{display:{participantConsumer:{id:'fake',version:1}}}};
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:2,state:'draft',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[],list:{sections:[{items:[{uid:'item',display:'x'}]}]},activity_settings:{item:{action:'display',participants:{mode:'explicit',ids:[]},consumer:{id:'fake',version:1},settings:{}}}};
 const provider=new AgendaParticipantContextProvider({repository:{},store:{},codec:new AgendaLaunchRefCodec(),clock:()=>new Date(),directory:{},authorize:async()=>true,resolveTarget:async()=>target});
 const source=await provider.resolveDraft({plan,itemUid:'item',viewer:{}});expect(source.selector).toEqual({schema:'participant-selector/v1',mode:'explicit',keys:[]});expect(source.target).toEqual(target);
});

it('rejects a fresh launch from an archived series',async()=>{
 const codec=new AgendaLaunchRefCodec();const target={kind:'app',appId:'fake'};
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:1,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'}};
 const provider=new AgendaParticipantContextProvider({repository:{readPlan:async()=>({document:plan}),readSeries:async()=>({document:{status:'archived'}})},store:{},codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{},authorize:async()=>true,resolveTarget:async()=>target});
 const ref=codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:1,action:'open',targetDigest:hashValue(target)});
 await expect(provider.resolve(ref,{viewer:{}})).rejects.toMatchObject({code:'agenda_not_launchable'});
});

it('rejects foreign households, stale revisions and target spoofing',async()=>{
 const codec=new AgendaLaunchRefCodec();const target={kind:'app',appId:'fake'};
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:2,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[],list:{sections:[{items:[{uid:'item',open:'fake'}]}]},activity_settings:{item:{action:'open',participants:{mode:'plan'},consumer:{id:'fake',version:1},settings:{}}}};
 const provider=new AgendaParticipantContextProvider({repository:{readPlan:async()=>({document:plan}),readSeries:async()=>({document:{status:'active'}})},store:{},codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{},authorize:async()=>true,resolveTarget:async()=>target});
 const make=overrides=>codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:2,action:'open',targetDigest:hashValue(target),...overrides});
 await expect(provider.authorizeAccess(make({householdId:'foreign'}),{action:'open',viewer:{}})).rejects.toMatchObject({code:'launch_not_found'});
 await expect(provider.resolve(make({revision:1}),{viewer:{}})).rejects.toMatchObject({code:'revision_conflict'});
 await expect(provider.resolve(make({targetDigest:'a'.repeat(64)}),{viewer:{}})).rejects.toMatchObject({code:'revision_conflict'});
});

it('uses shared setup preparation for Admin activity validation without retaining',async()=>{
 const {createAgendaActivityValidator}=await import('./AgendaParticipantContextProvider.mjs');
 const seen=[];const provider={resolveDraft:async({itemUid})=>({itemUid})};
 const setupResolver={resolve:async({resolvedSource})=>{seen.push(resolvedSource.itemUid);if(resolvedSource.itemUid==='bad')throw Object.assign(Error('Incomplete'),{code:'invalid_session_setup',field:'settings'});}};
 const validate=createAgendaActivityValidator({provider,setupResolver});
 const result=await validate({plan:{activity_settings:{good:{},bad:{}}},viewer:{}});
 expect(seen).toEqual(['good','bad']);expect(result).toEqual({valid:false,errors:[{field:'activity_settings.bad.settings',message:'Incomplete',code:'invalid_session_setup'}]});
});

it('passes the retained item and action to the authority boundary',async()=>{
 const codec=new AgendaLaunchRefCodec();let requested;
 const provider=new AgendaParticipantContextProvider({repository:{readPlan:async()=>({document:{household_id:'home',series_id:'family',plan_id:'plan'}})},store:{},codec,clock:()=>new Date(),directory:{},authorize:async value=>{requested=value;return true},resolveTarget:async()=>({})});
 const ref=codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:1,action:'open',targetDigest:'a'.repeat(64)});
 await provider.authorizeAccess(ref,{action:'open',viewer:{id:'viewer'}});expect(requested).toMatchObject({itemUid:'item',action:'open',viewer:{id:'viewer'}});
});

it('propagates temporary service failure during Admin validation',async()=>{
 const {createAgendaActivityValidator}=await import('./AgendaParticipantContextProvider.mjs');
 const validate=createAgendaActivityValidator({provider:{resolveDraft:async()=>({})},setupResolver:{resolve:async()=>{throw Object.assign(Error('Unavailable'),{code:'service_unavailable'});}}});
 await expect(validate({plan:{activity_settings:{item:{}}},viewer:{}})).rejects.toMatchObject({code:'service_unavailable'});
});

it('reports an unknown person at its roster path to runtime and Admin validation',async()=>{
 const {createAgendaActivityValidator}=await import('./AgendaParticipantContextProvider.mjs');
 const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};const codec=new AgendaLaunchRefCodec();
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:1,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[{id:'one',person:{kind:'guest',id:'missing'},display:{name:'Saved',avatar:null}}],list:{sections:[{items:[{uid:'item',open:'fake'}]}]},activity_settings:{item:{action:'open',participants:{mode:'plan'},consumer:{id:'fake',version:1},settings:{}}}};
 const provider=new AgendaParticipantContextProvider({repository:{readPlan:async()=>({document:plan}),readSeries:async()=>({document:{status:'active'}})},store:{},codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{resolve:async()=>null},authorize:async()=>true,resolveTarget:async()=>target});
 const ref=codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:1,action:'open',targetDigest:hashValue(target)});
 await expect(provider.resolve(ref,{viewer:{}})).rejects.toMatchObject({code:'invalid_participant_context',field:'participants.0.person'});
 const validate=createAgendaActivityValidator({provider,setupResolver:{resolve:async()=>{throw Error('unexpected')}}});
 expect(await validate({plan,viewer:{}})).toMatchObject({valid:false,errors:[{code:'invalid_participant_context',field:'participants.0.person'}]});
});

it('maps shared selector errors to the authored activity selector in Admin validation',async()=>{
 const {createAgendaActivityValidator}=await import('./AgendaParticipantContextProvider.mjs');
 const provider={resolveDraft:async()=>({})};const setupResolver={resolve:async()=>{throw Object.assign(Error('Empty'),{code:'participant_context_required',field:'selector.keys'});}};
 const validate=createAgendaActivityValidator({provider,setupResolver});
 expect(await validate({plan:{activity_settings:{item:{}}},viewer:{}})).toMatchObject({valid:false,errors:[{code:'participant_context_required',field:'activity_settings.item.participants.ids'}]});
});

it('surfaces selector and unknown-identity paths through runtime and Admin entry points',async()=>{
 const {createAgendaActivityValidator}=await import('./AgendaParticipantContextProvider.mjs');
 const {ParticipantLaunchService,ParticipantConsumerRegistry,ParticipantSetupResolver}=await import('../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};const codec=new AgendaLaunchRefCodec();
 const plan={household_id:'home',series_id:'family',plan_id:'plan',revision:1,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[{id:'one',person:{kind:'guest',id:'unknown'},display:{name:'Saved',avatar:null}}],list:{sections:[{items:[{uid:'item',open:'fake'}]}]},activity_settings:{item:{action:'open',participants:{mode:'explicit',ids:[]},consumer:{id:'fake',version:1},settings:{}}}};
 const store={inspect:async(_,build)=>build([]),reserve:async(_,build)=>build([])};
 const provider=new AgendaParticipantContextProvider({repository:{readPlan:async()=>({document:plan}),readSeries:async()=>({document:{status:'active'}})},store,codec,clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{resolve:async()=>null},authorize:async()=>true,resolveTarget:async()=>target});
 const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'optional',minParticipants:1,maxParticipants:5,selectorSupport:['all','explicit']}),prepareSetup:async()=>{throw Error('must not prepare')},begin:async()=>{throw Error('must not begin')}};
 const registry=new ParticipantConsumerRegistry();registry.register({consumer});const setupResolver=new ParticipantSetupResolver({registry});
 const validate=createAgendaActivityValidator({provider,setupResolver});const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async()=>target,logger:{info(){}}});
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:codec.encode({householdId:'home',planId:'plan',itemUid:'item',revision:1,action:'open',targetDigest:hashValue(target)})};
 const inspect=()=>service.inspect({ref,action:'open',viewer:{}});const begin=()=>service.begin({ref,action:'open',requestId:'r',intent:'new',viewer:{}});
 for (const operation of [inspect,begin]) await expect(operation()).rejects.toMatchObject({code:'invalid_participant_context',field:'participants.0.person'});
 expect(await validate({plan,viewer:{}})).toMatchObject({valid:false,errors:[{code:'invalid_participant_context',field:'participants.0.person'}]});
 plan.participants[0]={id:'one',anonymous:true,display:{name:'Saved',avatar:null}};
 for (const operation of [inspect,begin]) await expect(operation()).rejects.toMatchObject({code:'participant_context_required',field:'selector.keys'});
 expect(await validate({plan,viewer:{}})).toMatchObject({valid:false,errors:[{code:'participant_context_required',field:'activity_settings.item.participants.ids'}]});
 plan.activity_settings.item.participants.ids=['missing'];
 for (const operation of [inspect,begin]) await expect(operation()).rejects.toMatchObject({code:'invalid_participant_context',field:'selector.keys.0'});
 expect(await validate({plan,viewer:{}})).toMatchObject({valid:false,errors:[{code:'invalid_participant_context',field:'activity_settings.item.participants.ids.0'}]});
});
