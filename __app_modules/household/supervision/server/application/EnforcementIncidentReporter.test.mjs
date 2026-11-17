import {it,expect} from 'vitest';
import {EnforcementIncidentReporter} from './EnforcementIncidentReporter.mjs';
import {emptySupervisionState,serialQueue,validateSupervisionState} from '../../shared/contracts.mjs';
function fixture(){let state=emptySupervisionState(),now=1000;const queue=serialQueue(),parentAlerts=[];
 const repository={read:async()=>structuredClone(state),transaction:fn=>queue(async()=>{const next=structuredClone(state);const value=await fn(next);validateSupervisionState(next);state=next;return structuredClone(value);})};
 const notifyIncident=async event=>{parentAlerts.push(event);return {delivered:true};};
 const options={repository,notifyIncident,monotonicNow:()=>now};
 const row={deviceId:'portal',capability:'portal-keys',commandRevision:2,blocked:false,acknowledged:false,lastContactAt:null,error:'CAPABILITY_UNAVAILABLE'};
 return {repository,parentAlerts,options,row,observe:(reporter,time,health=row)=>{now=time;return reporter.observe({health:[health],desiredBlocked:true,nowMs:time});}};
}
it('one missing-ACK incident emits one alert and one later recovery',async()=>{
 const h=fixture(),reporter=new EnforcementIncidentReporter(h.options);
 await h.observe(reporter,1000);await h.observe(reporter,5999);expect(h.parentAlerts).toHaveLength(0);
 await h.observe(reporter,6000);await h.observe(reporter,7000);
 await h.observe(reporter,8000,{...h.row,blocked:true,acknowledged:true,lastContactAt:8000,error:null});
 await h.observe(reporter,9000,{...h.row,blocked:true,acknowledged:true,lastContactAt:9000,error:null});
 expect(h.parentAlerts.map(x=>x.type)).toEqual(['enforcement-unverified','enforcement-restored']);
 expect((await h.repository.read()).outbox).toEqual([]);
});
it('persists undelivered alerts and retries the same key after restart before reporting recovery',async()=>{
 const h=fixture();let delivered=false;const attempts=[];
 const options={...h.options,notifyIncident:async event=>{attempts.push(event);return {delivered};}};
 let reporter=new EnforcementIncidentReporter(options);await h.observe(reporter,1000);await h.observe(reporter,6000);
 expect(Object.values((await h.repository.read()).enforcementIncidents)[0].status).toBe('delivery-pending');
 reporter=new EnforcementIncidentReporter(options);delivered=true;await h.observe(reporter,8000,{...h.row,blocked:true,acknowledged:true,lastContactAt:8000,error:null});
 expect(attempts.map(x=>x.type)).toEqual(['enforcement-unverified','enforcement-unverified','enforcement-restored']);
 expect(attempts[0].incidentId).toBe(attempts[1].incidentId);
 expect(Object.values((await h.repository.read()).enforcementIncidents)[0].status).toBe('recovered');
});
it('does not recover from stale, released or obsolete acknowledgements',async()=>{
 const h=fixture(),reporter=new EnforcementIncidentReporter(h.options);await h.observe(reporter,1000);await h.observe(reporter,6000);
 await h.observe(reporter,8000,{...h.row,blocked:true,acknowledged:true,lastContactAt:1000});
 await h.observe(reporter,9000,{...h.row,blocked:false,acknowledged:true,lastContactAt:9000});
 await h.observe(reporter,10000,{...h.row,commandRevision:3,blocked:true,acknowledged:true,lastContactAt:10000});
 expect(h.parentAlerts.map(x=>x.type)).toEqual(['enforcement-unverified']);
});
it('upgrades old ledgers and rejects malformed incident state',()=>{
 const state=emptySupervisionState();delete state.enforcementIncidents;expect(validateSupervisionState(state).enforcementIncidents).toEqual({});
 expect(()=>validateSupervisionState({...state,enforcementIncidents:{bad:{status:'delivered'}}})).toThrow();
});

it('stops retrying transport acceptance while keeping phone delivery unknown',async()=>{
 const h=fixture(),attempts=[];const reporter=new EnforcementIncidentReporter({...h.options,notifyIncident:async event=>{attempts.push(event);return {accepted:true,delivered:null};}});
 await h.observe(reporter,1000);await h.observe(reporter,6000);await h.observe(reporter,8000);
 expect(attempts).toHaveLength(1);expect(Object.values((await h.repository.read()).enforcementIncidents)[0].alert.status).toBe('accepted');
});
it('uses the configured parent push route, retries failed delivery, and does not claim phone confirmation',async()=>{
 const {NotificationService}=await import('../../../../../__backend/src/3_applications/notification/NotificationService.mjs');
 const {PushNotificationAdapter}=await import('../../../../../__backend/src/1_adapters/notification/PushNotificationAdapter.mjs');
 const {NotificationPolicy}=await import('../../../../../__backend/src/2_domains/notification/services/NotificationPolicy.mjs');
 const {createEnforcementIncidentNotifier}=await import('../../../../../__backend/src/5_composition/modules/supervision.mjs');
 let ok=false;const calls=[],sent=[];
 const adapter=new PushNotificationAdapter({haGateway:{callService:async(...args)=>{calls.push(args);return {ok};}},resolveNotifyService:()=> 'mobile_app_parent'});
 const service=new NotificationService({adapters:[adapter],preferenceLoader:()=>({getChannelsFor:()=>['app']}),policy:new NotificationPolicy(),ledgerStore:{getLastSent:()=>null,recordSent:value=>sent.push(value)},clock:{now:()=>new Date(6000)}});
 const notify=createEnforcementIncidentNotifier({notificationService:service,recipientId:'parent'});
 const event={incidentId:'incident-1',type:'enforcement-unverified',deviceId:'portal',capability:'portal-keys',commandRevision:2,at:new Date(6000).toISOString()};
 expect(await notify(event)).toMatchObject({accepted:false});expect(sent).toHaveLength(0);
 ok=true;expect(await notify(event)).toMatchObject({accepted:true,delivered:null});expect(sent).toHaveLength(1);expect(calls).toHaveLength(2);
 expect(sent[0].dedupeKey).toBe('incident-1:enforcement-unverified');
 const unavailable=createEnforcementIncidentNotifier({notificationService:service});expect(await unavailable(event)).toMatchObject({accepted:false});expect(calls).toHaveLength(2);
});
it('retains pending legacy incident metadata across disk reopen without changing the Stop window',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {YamlShutdownDatastore}=await import('../../../../../__backend/src/1_adapters/persistence/yaml/YamlShutdownDatastore.mjs');
 const {ShutdownState}=await import('../../../../../__backend/src/2_domains/shutdown/ShutdownState.mjs');
 const dir=await mkdtemp(join(tmpdir(),'enforcement-incidents-'));const datastore=new YamlShutdownDatastore({configService:{getHouseholdPath:()=>dir}});
 let repository;
 try{
  await datastore.save(new ShutdownState({locked_at:new Date(1000).toISOString(),locked_until:new Date(1801000).toISOString(),targets:['school:portal'],source:{}}));
  const before=await readFile(datastore.path(),'utf8');repository=datastore.incidentRepository();
  let now=1000;const row={deviceId:'portal',capability:'portal-keys',commandRevision:1000,acknowledged:false,desiredBlocked:true};
  let reporter=new EnforcementIncidentReporter({repository,monotonicNow:()=>now,notifyIncident:async()=>({accepted:false,delivered:false})});
  await reporter.observe({health:[row],nowMs:now});now=6000;await reporter.observe({health:[row],nowMs:now});await repository.close();
  repository=datastore.incidentRepository();const alerts=[];reporter=new EnforcementIncidentReporter({repository,notifyIncident:async event=>{alerts.push(event);return {accepted:true,delivered:null};}});
  await reporter.observe({health:[{...row,acknowledged:true,blocked:true,lastContactAt:7000}],nowMs:7000});
  expect(alerts.map(event=>event.type)).toEqual(['enforcement-unverified','enforcement-restored']);
  expect((await reporter.incidents())[0]).toMatchObject({status:'recovered',alert:{status:'accepted'},recovery:{status:'accepted'}});
  expect(await readFile(datastore.path(),'utf8')).toBe(before);
 }finally{await repository?.close();await rm(dir,{recursive:true,force:true});}
});
it('does not turn suppression or in-app delivery into accepted parent notification',async()=>{
 const {createEnforcementIncidentNotifier}=await import('../../../../../__backend/src/5_composition/modules/supervision.mjs');
 for(const results of [[{channel:null,suppressed:true,delivered:false}],[{channel:'app',delivered:true}],[{channel:'push',suppressed:true,delivered:true}]]){
  const notify=createEnforcementIncidentNotifier({recipientId:'parent',notificationService:{send:async()=>results}});
  expect(await notify({incidentId:'i',type:'enforcement-unverified'})).toMatchObject({accepted:false,delivered:false});
 }
});
it('uses monotonic elapsed time for the first incident deadline',async()=>{
 const h=fixture();let monotonic=0;const reporter=new EnforcementIncidentReporter({...h.options,monotonicNow:()=>monotonic});
 await h.observe(reporter,1000);monotonic=4999;await h.observe(reporter,900000);expect(h.parentAlerts).toHaveLength(0);
 monotonic=5000;await h.observe(reporter,500);expect(h.parentAlerts).toHaveLength(1);
});
it('deduplicates concurrent observation and retains failed recovery for retry',async()=>{
 const h=fixture();let recoveryAccepted=false;const attempts=[];
 const reporter=new EnforcementIncidentReporter({...h.options,notifyIncident:async event=>{attempts.push(event);return {accepted:event.type==='enforcement-unverified'||recoveryAccepted,delivered:null};}});
 await h.observe(reporter,1000);await Promise.all([h.observe(reporter,6000),h.observe(reporter,6000)]);
 expect(attempts).toHaveLength(1);const ack={...h.row,acknowledged:true,blocked:true,lastContactAt:8000,error:null};
 await h.observe(reporter,8000,ack);expect((await reporter.incidents())[0].status).toBe('recovery-pending');recoveryAccepted=true;
 await h.observe(reporter,10000,{...ack,lastContactAt:10000});expect(attempts.map(event=>event.type)).toEqual(['enforcement-unverified','enforcement-restored','enforcement-restored']);
});
it('bounds failed delivery retries to the reconciliation cadence even with repeated observations',async()=>{
 const h=fixture(),attempts=[];const reporter=new EnforcementIncidentReporter({...h.options,notifyIncident:async event=>{attempts.push(event);return {accepted:false,delivered:false};}});
 await h.observe(reporter,1000);await h.observe(reporter,6000);await h.observe(reporter,6001);await h.observe(reporter,7999);
 expect(attempts).toHaveLength(1);await h.observe(reporter,8000);expect(attempts).toHaveLength(2);
});
it('keeps one pending notification record per required push incident during retries',async()=>{
 const {NotificationService}=await import('../../../../../__backend/src/3_applications/notification/NotificationService.mjs');
 const service=new NotificationService({adapters:[{channel:'push',send:async()=>({accepted:false,delivered:false})}]});
 const intent={category:'system',urgency:'high',dedupeKey:'one',metadata:{username:'parent',deliveryRequired:'push'}};
 await service.send(intent);await service.send(intent);expect(service.getPending()).toHaveLength(1);
});
it('records the capability failure that follows an initially pending Stop',async()=>{
 const h=fixture(),reporter=new EnforcementIncidentReporter(h.options);
 await h.observe(reporter,1000,{...h.row,error:null});await h.observe(reporter,6000,h.row);
 expect(h.parentAlerts[0].error).toBe('CAPABILITY_UNAVAILABLE');
});
