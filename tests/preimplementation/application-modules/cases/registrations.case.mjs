// Standalone preparation cases: no controller, provider, network or private data.
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createApiRouter} from '../../../../backend/src/4_api/v1/routers/api.mjs';
import {createProxyRouter} from '../../../../backend/src/4_api/v1/routers/proxy.mjs';
import {createEventBusRouter} from '../../../../backend/src/4_api/v1/routers/admin/eventbus.mjs';
import {mountAgentHttp} from '../../../../backend/src/4_api/v1/agents/mountAgentHttp.mjs';
import {AdapterRegistry} from '../../../../backend/src/5_composition/integrations/AdapterRegistry.mjs';
import {IntegrationLoader} from '../../../../backend/src/5_composition/integrations/IntegrationLoader.mjs';
import {PressureMatAdapter} from '../../../../backend/src/1_adapters/hardware/pressure-mat/PressureMatAdapter.mjs';
import * as hostProfiles from '../../../../_extensions/fingerprint/src/profileStore.mjs';
import * as fitnessProfiles from '../../../../_extensions/fitness/src/profileStore.mjs';
import {addFingerprintEntry as centralAdd, createFingerprintProfileWriter} from '../../../../backend/src/3_applications/fitness/fingerprintProfileWriter.mjs';
import {buildFingerprintIdentityIndex} from '../../../../backend/src/3_applications/fitness/identityRelay.mjs';
import {BarcodeFirmwareGateway,FoodScaleFirmwareGateway,OmrFirmwareGateway,AutomotiveFirmwareGateway} from '../../../../backend/src/1_adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs';
import {createOmrRelay} from '../../../../backend/src/3_applications/hardware/omrRelay.mjs';
import {createAutomotiveRelay} from '../../../../backend/src/3_applications/hardware/automotiveRelay.mjs';
import {createEinkRouter} from '../../../../backend/src/4_api/v1/routers/eink.mjs';
import {HttpPlaybackHubAdapter} from '../../../../backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs';
import {resetPianoBridge} from '../../../../frontend/src/modules/Piano/PianoKiosk/pianoBridgeClient.js';
import {EventBusBiometricGateway} from '../../../../backend/src/1_adapters/fitness/EventBusBiometricGateway.mjs';
import {createContinuousScanLoop,faultBackoffMs} from '../../../../_extensions/fitness/src/continuousScanLoop.mjs';
import {BleHeartRateDecoder} from '../../../../_extensions/fitness/src/decoders/heart_rate.mjs';
import {SchoolCalcRelayCredentialVerifier} from '../../../../backend/src/1_adapters/schoolcalc/SchoolCalcRelayCredentialVerifier.mjs';
import {createSchoolCalcIngressAuthenticator} from '../../../../backend/src/4_api/v1/middleware/schoolCalcIngress.mjs';
import {SyncSchoolCalcDevice} from '../../../../backend/src/3_applications/school/schoolcalc/SyncSchoolCalcDevice.mjs';
import {createTi86StringFile} from '../../../../_extensions/ti86-app/tools/lib/ti86-string-file.mjs';
import {ConfigService} from '../../../../backend/src/0_system/config/ConfigService.mjs';
import {DataService} from '../../../../backend/src/1_adapters/persistence/files/DataService.mjs';
import {YamlAdminConfigStore} from '../../../../backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs';
import {YamlUserProfileDatastore} from '../../../../backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs';
import {HouseholdAdminService} from '../../../../backend/src/3_applications/admin/HouseholdAdminService.mjs';
import {DataServiceAuthAccountRepository} from '../../../../backend/src/1_adapters/auth/DataServiceAuthAccountRepository.mjs';
import {ConfigUserDirectory} from '../../../../backend/src/1_adapters/identity/ConfigUserDirectory.mjs';
import {YamlGratitudeDatastore} from '../../../../backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs';
import DefaultImagePrintGateway,{TemporaryImagePrintGateway} from '../../../../backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs';
import {IImagePrintGateway} from '../../../../backend/src/3_applications/gratitude/ports/IImagePrintGateway.mjs';
import {GratitudeFeedAdapter} from '../../../../backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs';
import {AssignItemToUser} from '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs';
import {HomeBotContainer} from '../../../../backend/src/3_applications/homebot/HomeBotContainer.mjs';
import {HomeBotEventRouter} from '../../../../backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs';
import {ConfigHouseholdAdapter} from '../../../../backend/src/1_adapters/homebot/ConfigHouseholdAdapter.mjs';
import {GratitudeHouseholdService} from '../../../../backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs';
import {GratitudeService} from '../../../../backend/src/3_applications/gratitude/services/GratitudeService.mjs';
import {createGratitudeRouter} from '../../../../backend/src/4_api/v1/routers/gratitude.mjs';
import * as pureTime from '../../../../backend/src/2_domains/core/utils/time.mjs';
import * as clockTime from '../../../../backend/src/0_system/utils/time.mjs';
import * as runtimeIds from '../../../../backend/src/0_system/utils/id.mjs';
import * as utilityBarrel from '../../../../backend/src/0_system/utils/index.mjs';
import * as systemErrors from '../../../../backend/src/0_system/utils/errors/index.mjs';
import * as infrastructureErrors from '../../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';
import * as domainErrors from '../../../../backend/src/2_domains/core/errors/index.mjs';
import DefaultValidationError from '../../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import {wireRequest} from '../drivers/http-wire.mjs';
const logger = Object.fromEntries(['info', 'debug', 'warn', 'error'].map(k => [k, () => {}]));
const check = (name, fn) => test('CASE-REG-' + name, {timeout: 5000}, fn);
const application = () => { const app = express(); app.use(express.json()); return app; };

test('CASE-UTILITY-PURE-TIME explicit dates retain validation timezone fallback and millisecond behavior',()=>{
  const date=new Date('2026-09-05T12:00:00.123Z');
  assert.equal(pureTime.formatLocalTimestamp(date),'2026-09-05 05:00:00');
  assert.equal(pureTime.formatIsoLocal(date),'2026-09-05T05:00:00-07:00');
  assert.equal(pureTime.formatIsoLocal(date,'Asia/Kolkata'),'2026-09-05T17:30:00+05:30');
  assert.equal(pureTime.getDateInTimezone(date,'Asia/Tokyo'),'2026-09-05');
  assert.equal(pureTime.formatLocalTimestamp(date,'Invalid/AuditZone'),'2026-09-05 12:00:00');
  assert.equal(pureTime.formatIsoLocal(date,'Invalid/AuditZone'),'2026-09-05T12:00:00.123Z');
  for(const value of [undefined,null,0,'2026-09-05',new Date(NaN)])
    assert.throws(()=>pureTime.formatLocalTimestamp(value),/requires a valid Date parameter/);
  for(const value of [undefined,null,0,false,'','not-a-date'])assert.equal(pureTime.parseToDate(value),null);
  const parsed=pureTime.parseToDate(date);assert.notEqual(parsed,date);assert.equal(parsed.getTime(),date.getTime());
  assert.throws(()=>pureTime.getHourInTimezone(date,'Invalid/AuditZone'),RangeError);
});
test('CASE-UTILITY-CLOCK clock defaults remain LA and Intl failure retains existing UTC fallbacks',t=>{
  mock.timers.enable({apis:['Date'],now:new Date('2026-09-05T12:00:00.123Z').getTime()});
  try{
    assert.equal(clockTime.formatLocalTimestamp(),'2026-09-05 05:00:00');
    assert.equal(clockTime.nowTs(),'2026-09-05 05:00:00 am');
    assert.equal(clockTime.nowTs24(),'2026-09-05 05:00:00');
    assert.equal(clockTime.nowDate(),'2026-09-05');assert.equal(clockTime.nowMonth(),'2026-09');
    assert.equal(clockTime.getCurrentDate('UTC'),'2026-09-05');
    assert.equal(clockTime.getCurrentHour('UTC'),12);
    assert.throws(()=>clockTime.getCurrentHour('Invalid/AuditZone'),RangeError);
    assert.equal(clockTime.parseToDate,pureTime.parseToDate);
    assert.notEqual(clockTime.formatLocalTimestamp,pureTime.formatLocalTimestamp);
    const formatter=t.mock.method(Intl,'DateTimeFormat',function(){throw new Error('synthetic Intl failure');});
    try{
      assert.equal(clockTime.nowTs(),'2026-09-05 12:00:00');
      assert.equal(clockTime.nowTs24(),'2026-09-05 12:00:00');
      assert.equal(clockTime.nowMonth(),'2026-09');
    }finally{formatter.mock.restore();}
  }finally{mock.timers.reset();}
});
test('CASE-UTILITY-ID runtime entropy and legacy validators keep lengths formats and object identities',()=>{
  assert.match(runtimeIds.shortId(),/^[A-Za-z0-9]{10}$/);
  assert.match(runtimeIds.shortIdLower(),/^[a-z0-9]{10}$/);
  assert.match(runtimeIds.hexId(),/^[0-9a-f]{8}$/);
  assert.equal(runtimeIds.shortId(0),'');assert.equal(runtimeIds.hexId(0),'');
  assert.equal(runtimeIds.entropyBytes(7).length,7);
  assert.match(runtimeIds.uuid(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(runtimeIds.shortIdFromUuid('audit-id'),'nSyXfxJ8ZU');
  assert.equal(runtimeIds.shortIdFromUuid('audit-id',99).length,32); // Hash truncation, not padding.
  assert.equal(runtimeIds.isUuid('550e8400-e29b-41d4-a716-446655440000'),true);
  assert.equal(runtimeIds.isUuid('550e8400-e29b-71d4-a716-446655440000'),false);
  assert.equal(runtimeIds.isShortId('abcdefghij'),true);assert.equal(runtimeIds.isShortId(123),false);
  assert.equal(runtimeIds.default,runtimeIds.IdUtils);assert.equal(utilityBarrel.ShortId,runtimeIds.IdUtils);
  assert.equal(utilityBarrel.shortId,runtimeIds.shortId);assert.equal(utilityBarrel.nowTs24,clockTime.nowTs24);
});
test('CASE-UTILITY-ERROR-IDENTITY named default and aggregate routes retain constructors and distinct error families',()=>{
  assert.equal(DefaultValidationError,domainErrors.ValidationError);
  for(const name of ['InfrastructureError','ExternalServiceError','RateLimitError','PersistenceError','TimeoutError'])
    assert.equal(systemErrors[name],infrastructureErrors[name]);
  assert.equal(infrastructureErrors.default,infrastructureErrors.InfrastructureError);
  const context={code:'AUDIT',field:'value',value:0,details:{audit:true}};
  const validation=new domainErrors.ValidationError('invalid',context);
  assert.equal(validation.context,context);assert.equal(validation.details,context.details);
  assert.equal(validation.value,0);assert.equal(validation instanceof DefaultValidationError,true);
  assert.equal(Object.hasOwn(validation,'timestamp'),false);
  const notFound=new domainErrors.EntityNotFoundError('audit',0,{details:context.details});
  assert.equal(notFound.message,'audit not found: 0');assert.equal(notFound.entityId,0);
  for(const name of ['ConfigurationError','SchedulerError','EventBusError','FileIOError']){
    const error=new systemErrors[name]('synthetic',context);
    assert.equal(error.name,name);assert.equal(error.code,'AUDIT');assert.equal(error.details,context.details);
    assert.equal(error instanceof infrastructureErrors.InfrastructureError,false);
    assert.equal(Object.hasOwn(error,'timestamp'),false);
  }
});
test('CASE-UTILITY-INFRA-ERROR construction JSON subclass overrides and retry semantics remain unchanged',()=>{
  mock.timers.enable({apis:['Date'],now:new Date('2026-09-05T12:00:00Z').getTime()});
  try{
    const context={code:'AUDIT',trace:'synthetic'},error=new infrastructureErrors.InfrastructureError('failed',context);
    assert.equal(error.context,context);
    assert.deepEqual(error.toJSON(),{name:'InfrastructureError',message:'failed',code:'AUDIT',context,
      timestamp:'2026-09-05 05:00:00',httpStatus:500,retryable:false});
    const external=new infrastructureErrors.ExternalServiceError('audit','failed',{service:'context-override'});
    assert.equal(external.service,'audit');assert.equal(external.context.service,'context-override');
    assert.equal(external.httpStatus,502);assert.equal(external.code,'EXTERNAL_SERVICE_ERROR');
    const limited=new infrastructureErrors.RateLimitError('audit',0,{retryAfter:99});
    assert.equal(limited.message,'Rate limit exceeded for audit');assert.equal(limited.retryAfter,0);
    assert.equal(limited.context.retryAfter,99);assert.equal(infrastructureErrors.isRateLimitError(limited),true);
    for(const operation of ['read','write','delete','READ'])
      assert.equal(new infrastructureErrors.PersistenceError(operation,'failed').retryable,operation==='read');
    const timeout=new infrastructureErrors.TimeoutError('audit',0);assert.equal(timeout.httpStatus,504);
    assert.equal(infrastructureErrors.isRetryableError(timeout),true);
    assert.equal(infrastructureErrors.isRetryableError({retryable:true}),false);
    const axios=infrastructureErrors.ExternalServiceError.fromAxiosError('audit',{
      message:'outer',response:{status:503,statusText:'Unavailable',data:{message:'inner',error:'ignored'}},
      config:{url:'/synthetic',method:'get'}});
    assert.equal(axios.message,'audit error: inner');assert.equal(axios.context.statusCode,503);
  }finally{mock.timers.reset();}
});
test('CASE-UTILITY-VENDOR translation retains status precedence and does not expose vendor messages',()=>{
  const input={status:400,response:{status:503},message:'synthetic vendor detail',code:'ETIMEDOUT'};
  const translated=systemErrors.translateVendorError(input,{op:'audit'});
  assert.equal(translated.message,'Operation failed: audit');assert.equal(translated.code,'INVALID_REQUEST');
  assert.equal(translated.status,400);assert.equal(translated.isTransient,true);
  assert.equal(Object.hasOwn(translated,'cause'),false);
  assert.equal(systemErrors.isTransientStatus({status:'429'}),false);
  assert.equal(systemErrors.isTransientStatus({status:'503'}),true);
  const refused=systemErrors.translateVendorError({code:'ECONNREFUSED'});
  assert.equal(refused.code,'UNKNOWN_ERROR');assert.equal(refused.isTransient,true);
  assert.equal(systemErrors.translateVendorError(null).message,'Operation failed: request');
});

function assignmentFixture(options={}){
  const calls=[],logs=[],items=[{id:'audit-item',text:'Together',extra:'not-broadcast'}];
  const state=Object.hasOwn(options,'state')?options.state:{flowState:{items,category:'gratitude'}};
  const failure=new Error('synthetic '+(options.failAt||'failure'));
  const step=(name,...args)=>{calls.push([name,...args]);if(options.failAt===name)throw failure;};
  const config={
    messagingGateway:{updateMessage(...args){step('update',...args);}},
    conversationStateStore:{get(...args){step('get',...args);return state;},delete(...args){step('delete',...args);}},
    gratitudeService:{addSelections(...args){assert.equal(this,config.gratitudeService);step('save',...args);return options.save?.(...args);}},
    householdService:{getHouseholdId(){step('household');return 'audit-household';},
      getMemberDisplayName(...args){step('name',...args);return Object.hasOwn(options,'displayName')?options.displayName:'Family A';}},
    websocketBroadcast(...args){step('broadcast',...args);return options.broadcast?.(...args);},
    logger:Object.fromEntries(['info','warn','error'].map(level=>[level,(...args)=>logs.push([level,...args])]))
  };
  const input={conversationId:'audit-conversation',messageId:'audit-message',username:'audit-user'};
  return {config,input,items,state,calls,logs,failure,run:(extra={})=>new AssignItemToUser(config).execute({...input,...extra})};
}
test('CASE-GR-HOMEBOT-ORDER batch completion gates naming broadcast message and deletion; response context stays bound',async()=>{
  let finishSave,reachedSave;const saved=new Promise(resolve=>{finishSave=resolve;}),entered=new Promise(resolve=>{reachedSave=resolve;});
  const f=assignmentFixture({save:()=>{reachedSave();return saved;}}),context={updateMessage(...args){
    assert.equal(this,context);f.calls.push(['bound-update',...args]);}};
  const pending=f.run({responseContext:context});await entered;
  assert.deepEqual(f.calls.map(c=>c[0]),['get','household','save']);
  const args=f.calls[2].slice(1);assert.deepEqual(args.slice(0,3),['audit-household','gratitude','audit-user']);
  assert.equal(args[3],f.items);assert.equal(args.length,5);assert.equal(typeof args[4],'string');
  finishSave(false); // A false result is not treated as a failed command.
  assert.deepEqual(await pending,{success:true,itemCount:1,username:'audit-user',category:'gratitude',displayName:'Family A'});
  assert.deepEqual(f.calls.slice(3),[
    ['name',null,'audit-user'],['broadcast',{topic:'gratitude',action:'item_added',items:[{id:'audit-item',text:'Together'}],
      userId:'audit-user',userName:'Family A',category:'gratitude',source:'homebot'}],
    ['bound-update','audit-message','✅ Saved 1 gratitude item for Family A'],['delete','audit-conversation','audit-message']]);
});
test('CASE-GR-HOMEBOT-EARLY expired state and absent items only update the confirmation and retain state',async()=>{
  for(const state of [null,{}, {flowState:{}},{flowState:{items:[]}}]){
    const f=assignmentFixture({state}),expired=state===null;
    assert.deepEqual(await f.run(),{success:false,error:expired?'No state found - selection may have expired':'No items found in state'});
    assert.deepEqual(f.calls,[['get','audit-conversation','audit-message'],['update','audit-conversation','audit-message',
      expired?'❌ This selection has expired. Please try again.':'❌ No items found to save.']]);
  }
  for(const failAt of ['get','household']){
    const f=assignmentFixture({failAt});await assert.rejects(f.run(),error=>error===f.failure);
    assert.equal(f.calls.some(c=>['save','update','delete','broadcast'].includes(c[0])),false);
    assert.equal(f.logs.at(-1)[1],'assignItemToUser.error');
  }
});
test('CASE-GR-HOMEBOT-SAVE-ERROR synchronous rejection asynchronous rejection and invalid timezone retain selection state',async()=>{
  for(const asynchronous of [false,true]){
    const failure=new Error('synthetic save rejection');
    const f=assignmentFixture({save:()=>{if(asynchronous)return Promise.reject(failure);throw failure;}});
    assert.deepEqual(await f.run(),{success:false,error:'Failed to save items: synthetic save rejection'});
    assert.deepEqual(f.calls.map(c=>c[0]),['get','household','save','update']);
    assert.equal(f.calls.at(-1)[3],'❌ Failed to save items. Please try again.');
    assert.equal(f.logs.at(-1)[1],'assignItemToUser.saveError');
  }
  const f=assignmentFixture();const result=await f.run({timezone:'Invalid/AuditZone'});
  assert.equal(result.success,false);assert.match(result.error,/Failed to save items:.*Invalid\/AuditZone/);
  assert.deepEqual(f.calls.map(c=>c[0]),['get','household','update']);
});
test('CASE-GR-HOMEBOT-POSTSAVE downstream failures propagate without compensating a completed save',async()=>{
  const order=['get','household','save','name','broadcast','update','delete'];
  for(const failAt of ['name','broadcast','update','delete']){
    const f=assignmentFixture({failAt});await assert.rejects(f.run(),error=>error===f.failure);
    assert.deepEqual(f.calls.map(c=>c[0]),order.slice(0,order.indexOf(failAt)+1));
    assert.equal(f.calls.filter(c=>c[0]==='save').length,1);assert.equal(f.logs.at(-1)[1],'assignItemToUser.error');
  }
  const f=assignmentFixture({failAt:'update',save:()=>Promise.reject(new Error('synthetic save failure'))});
  await assert.rejects(f.run(),error=>error===f.failure); // Failed error-message delivery rejects instead of returning save-error DTO.
  assert.deepEqual(f.logs.filter(c=>c[0]==='error').map(c=>c[1]),['assignItemToUser.saveError','assignItemToUser.error']);
});
test('CASE-GR-HOMEBOT-BROADCAST-SYNC broadcast return is not awaited and an absent broadcaster remains optional',async()=>{
  let thenReads=0;const f=assignmentFixture({broadcast:()=>({get then(){thenReads++;throw new Error('must not await broadcast');}})});
  assert.equal((await f.run()).success,true);assert.equal(thenReads,0);
  const without=assignmentFixture();delete without.config.websocketBroadcast;delete without.config.householdService.getMemberDisplayName;
  assert.equal((await without.run()).displayName,'audit-user');
  assert.deepEqual(without.calls.map(c=>c[0]),['get','household','save','update','delete']);
});
test('CASE-GR-HOMEBOT-DEFAULTS command category and returned category differ; explicit timezone keeps locale formatting',async()=>{
  const original=Date.prototype.toLocaleString,formats=[];
  Date.prototype.toLocaleString=function(...args){assert.ok(this instanceof Date);formats.push(args);return 'audit-locale-timestamp';};
  try{
    for(const category of [undefined,'','hopes','HOPES']){
      const f=assignmentFixture({state:{flowState:{category,items:[{id:'a',text:'A'},{id:'b',text:'B'}]}},displayName:''});
      const result=await f.run({timezone:'UTC'}),save=f.calls.find(c=>c[0]==='save');
      assert.equal(save[2],category||'gratitude');assert.equal(save[5],'audit-locale-timestamp');
      assert.equal(result.category,category);assert.equal(Object.hasOwn(result,'category'),true);assert.equal(result.displayName,'audit-user');
      assert.equal(f.calls.find(c=>c[0]==='update')[3],`✅ Saved 2 ${category==='hopes'?'hopes':'gratitude'} items for audit-user`);
    }
    assert.deepEqual(formats,Array.from({length:4},()=>['en-US',{timeZone:'UTC'}]));
  }finally{Date.prototype.toLocaleString=original;}
});
test('CASE-GR-HOMEBOT-CONTAINER assignment remains lazy cached and validates dependencies only at first lookup',async()=>{
  const f=assignmentFixture(),container=new HomeBotContainer({...f.config,householdRepository:f.config.householdService});
  assert.deepEqual(f.calls,[]);const [one,two]=await Promise.all([container.getAssignItemToUser(),container.getAssignItemToUser()]);
  assert.equal(one,two);assert.ok(one instanceof AssignItemToUser);assert.equal(container.getMessagingGateway(),f.config.messagingGateway);
  assert.equal((await one.execute(f.input)).success,true);
  const incomplete=new HomeBotContainer({logger});await assert.rejects(incomplete.getAssignItemToUser(),{message:'messagingGateway is required'});
  for(const key of ['messagingGateway','conversationStateStore','gratitudeService','householdService']){
    const config={...f.config};delete config[key];assert.throws(()=>new AssignItemToUser(config),{message:key+' is required'});
  }
});
test('CASE-GR-HOMEBOT-ROUTER assignment callback passes only conversation message and suffix username',async()=>{
  const calls=[],answer={synthetic:'result'},router=new HomeBotEventRouter({getAssignItemToUser:async()=>({execute:input=>{calls.push(input);return answer;}})},{logger});
  const result=await router.route({type:'callback',data:'user:audit:user:tail',conversationId:'audit-conversation',messageId:'audit-message',
    timezone:'UTC',responseContext:{ignored:true}});
  assert.equal(result,answer);assert.deepEqual(calls,[{conversationId:'audit-conversation',messageId:'audit-message',username:'audit:user:tail'}]);
  assert.equal(await router.route({type:'callback',data:'other:user:audit'}),null);
});
test('CASE-GR-HOMEBOT-BATCH real batch command keeps duplicates and does not use single-selection transfer semantics',async()=>{
  const writes=[],store={addSelection(...args){writes.push(args);return false;},
    getSelections(){throw new Error('batch must not check duplicates');},removeOption(){throw new Error('batch must not transfer options');}};
  const service=new GratitudeService({store}),items=[{id:'same-item',text:'First',extra:true},{id:'same-item',text:'Again'},{text:'Generated ID'}];
  const result=await service.addSelections('audit-household','UNVALIDATED-CATEGORY','audit-user',items,'audit-stamp');
  assert.equal(result.length,3);assert.equal(writes.length,3);
  for(const [index,args] of writes.entries()){
    assert.deepEqual(args.slice(0,2),['audit-household','UNVALIDATED-CATEGORY']);assert.equal(args[2],result[index]);
    assert.equal(result[index].userId,'audit-user');assert.equal(result[index].datetime,'audit-stamp');assert.deepEqual(result[index].printed,[]);
    assert.equal(result[index].item.text,items[index].text);assert.notEqual(result[index].item,items[index]);assert.equal(result[index].item.extra,undefined);
  }
  assert.equal(result[0].item.id,'same-item');assert.equal(result[1].item.id,'same-item');assert.ok(result[2].item.id);
  assert.equal(new Set(result.map(s=>s.id)).size,3);assert.equal(Object.hasOwn(items[2],'id'),false);
});
test('CASE-GR-HOMEBOT-BATCH-PARTIAL original batch failure leaves earlier writes and retry can repeat them',async()=>{
  const persisted=[],failure=new Error('synthetic second write'),items=[{id:'a',text:'A'},{id:'b',text:'B'}];
  let shouldFail=true;const service=new GratitudeService({store:{addSelection(_household,_category,selection){
    if(shouldFail&&selection.item.id==='b')throw failure;persisted.push(selection);}}});
  const f=assignmentFixture({state:{flowState:{category:'gratitude',items}}});f.config.gratitudeService=service;
  assert.deepEqual(await f.run(),{success:false,error:'Failed to save items: synthetic second write'});
  assert.deepEqual(persisted.map(s=>s.item.id),['a']);assert.equal(f.calls.some(c=>['name','broadcast','delete'].includes(c[0])),false);
  shouldFail=false;assert.equal((await f.run()).success,true);assert.deepEqual(persisted.map(s=>s.item.id),['a','a','b']);
  const before=persisted.length;await assert.rejects(service.addSelections('audit-household','gratitude','audit-user',items,''),
    error=>error.message==='timestamp required'&&error.code==='MISSING_TIMESTAMP');assert.equal(persisted.length,before);
});

function householdProjectionFixture(config){
  const homebot=new ConfigHouseholdAdapter({configService:config,logger});
  const gratitude=new GratitudeHouseholdService({householdDirectory:{timezone:id=>config.getHouseholdTimezone?.(id),
    defaultHouseholdId:()=>config.getDefaultHouseholdId(),userIds:id=>config.getHouseholdUsers?.(id),userProfile:id=>config.getUserProfile?.(id)},
    gratitudeService:{isValidCategory:category=>['gratitude','hopes'].includes(category)}});
  return {homebot,gratitude};
}
test('CASE-HOUSEHOLD-PROJECTION-NAMES roster names differ from confirmation labels without deduplication or caching',async()=>{
  const users={alex:{display_name:'Alex',group_label:'Parent',name:'Other',group:'adults'},bryn:{name:'Bryn'},casey:{display_name:'',group_label:''}};
  const roster=['alex','bryn','casey','missing','alex'];
  const config=new ConfigService({system:{defaultHouseholdId:'audit-household'},households:{'audit-household':{users:roster}},users});
  const {gratitude,homebot}=householdProjectionFixture(config);
  assert.deepEqual(gratitude.getHouseholdUsers(null),[
    {id:'alex',name:'Alex',group_label:'Parent'},{id:'bryn',name:'Bryn',group_label:null},{id:'casey',name:'Casey',group_label:null},
    {id:'missing',name:'Missing',group_label:null},{id:'alex',name:'Alex',group_label:'Parent'}]);
  assert.deepEqual(await homebot.getMembers(),[
    {userId:'alex',displayName:'Alex',groupLabel:'Parent',group:'adults'},{userId:'bryn',displayName:'Bryn',groupLabel:null,group:null},
    {userId:'casey',displayName:'Casey',groupLabel:null,group:null},{userId:'missing',displayName:'Missing',groupLabel:null,group:null},
    {userId:'alex',displayName:'Alex',groupLabel:'Parent',group:'adults'}]);
  assert.equal(gratitude.resolveDisplayName('alex'),'Parent');assert.equal(await homebot.getMemberDisplayName('ignored-household','alex'),'Parent');
  users.alex.group_label='Changed';roster.reverse();
  assert.equal(gratitude.resolveDisplayName('alex'),'Changed');assert.equal((await homebot.getMembers())[1].userId,'missing');
  assert.equal(gratitude.getHouseholdUsers()[1].id,'missing');assert.equal(config.getHouseholdUsers(),roster);
});
test('CASE-HOUSEHOLD-PROJECTION-DEFAULTS timezone fallback and category validation remain caller-specific',async()=>{
  const config=new ConfigService({system:{defaultHouseholdId:'audit-household',timezone:'Asia/Tokyo'},households:{
    'audit-household':{timezone:''},explicit:{timezone:'UTC'}}});
  const {gratitude,homebot}=householdProjectionFixture(config);
  assert.equal(gratitude.getDefaultHouseholdId(),'audit-household');assert.equal(homebot.getHouseholdId(),'audit-household');
  assert.equal(gratitude.getTimezone(null),'UTC');assert.equal(await homebot.getTimezone(null),'');
  assert.equal(gratitude.getTimezone('missing'),'Asia/Tokyo');assert.equal(await homebot.getTimezone('missing'),'Asia/Tokyo');
  assert.equal(gratitude.validateCategory('HOPES'),'hopes');assert.equal(gratitude.validateCategory(' hopes '),null);
  assert.equal(gratitude.validateCategory(null),null);assert.equal(gratitude.validateCategory({toString:()=> 'GRATITUDE'}),'gratitude');
  const sparse=householdProjectionFixture({getDefaultHouseholdId:()=>undefined});
  assert.equal(sparse.gratitude.getDefaultHouseholdId(),undefined);assert.equal(sparse.gratitude.getTimezone(),'UTC');
  assert.deepEqual(sparse.gratitude.getHouseholdUsers(),[]);assert.equal(sparse.gratitude.resolveDisplayName('alex'),'Alex');
  await assert.rejects(sparse.homebot.getMembers(),TypeError);await assert.rejects(sparse.homebot.getTimezone(),TypeError);
});
test('CASE-HOUSEHOLD-PROJECTION-INVALID Homebot object roster support does not imply identical Gratitude handling',async()=>{
  const lookups=[],config={getDefaultHouseholdId:()=> 'audit-household',getHouseholdUsers:()=>[{username:'alex'},{}],
    getUserProfile:id=>{lookups.push(id);return null;}};
  const {gratitude,homebot}=householdProjectionFixture(config);
  assert.deepEqual(await homebot.getMembers(),[{userId:'alex',displayName:'Alex',groupLabel:null,group:null},
    {userId:undefined,displayName:'Unknown',groupLabel:null,group:null}]);
  assert.throws(()=>gratitude.getHouseholdUsers(),TypeError);
  lookups.length=0;assert.equal(gratitude.resolveDisplayName(null),'Unknown');assert.deepEqual(lookups,[]);
  assert.equal(await homebot.getMemberDisplayName(null,null),'Unknown');assert.deepEqual(lookups,[null]);
  const failure=new Error('synthetic profile failure');config.getUserProfile=()=>{throw failure;};
  assert.throws(()=>gratitude.resolveDisplayName('alex'),error=>error===failure);
  await assert.rejects(homebot.getMemberDisplayName(null,'alex'),error=>error===failure);
});
test('CASE-HOUSEHOLD-PROJECTION-USER-DIRECTORY existing general roster is not a drop-in replacement for the presentation projection',()=>{
  const warnings=[],config=new ConfigService({system:{defaultHouseholdId:'audit-household'},households:{'audit-household':{users:['alex','missing','bryn','alex']}},
    users:{alex:{username:'profile-alex',name:'Legacy Alex',group_label:''},bryn:{name:'Legacy Bryn'}}});
  const users=new ConfigUserDirectory(config,{logger:{warn:(...args)=>warnings.push(args)}}),{gratitude}=householdProjectionFixture(config);
  assert.deepEqual(gratitude.getHouseholdUsers(),[{id:'alex',name:'Legacy Alex',group_label:null},{id:'missing',name:'Missing',group_label:null},
    {id:'bryn',name:'Legacy Bryn',group_label:null},{id:'alex',name:'Legacy Alex',group_label:null}]);
  assert.deepEqual(users.getHouseholdRoster(),[{id:'profile-alex',name:'profile-alex',group_label:'',birthyear:null},
    {id:'bryn',name:'bryn',group_label:null,birthyear:null},{id:'profile-alex',name:'profile-alex',group_label:'',birthyear:null}]);
  assert.equal(warnings.length,1);assert.equal(warnings[0][0],'user.roster_profile_missing');
  assert.equal(users.resolveGroupLabel('alex'),'profile-alex');assert.equal(gratitude.resolveDisplayName('alex'),'Legacy Alex');
});
test('CASE-HOUSEHOLD-PROJECTION-READ-ORDER optional profile reads retain short-circuit field order and original value types',()=>{
  const calls=[],payload={synthetic:'label'},profile={get display_name(){calls.push('display');return payload;},
    get name(){calls.push('name');throw new Error('unselected fallback');},get group_label(){calls.push('group');return '';}};
  const config={getDefaultHouseholdId(){assert.equal(this,config);calls.push('default');return undefined;},
    getHouseholdUsers(...args){assert.equal(this,config);calls.push(['users',...args]);return ['alex'];},
    getUserProfile(...args){assert.equal(this,config);calls.push(['profile',...args]);return profile;}};
  const {gratitude}=householdProjectionFixture(config),rows=gratitude.getHouseholdUsers(null);
  assert.equal(rows[0].name,payload);assert.deepEqual(Object.keys(rows[0]),['id','name','group_label']);
  assert.deepEqual(calls,[['users',null],['profile','alex'],'display','group']);
  calls.length=0;assert.equal(gratitude.resolveDisplayName('alex'),payload);assert.deepEqual(calls,[['profile','alex'],'group','display']);
  calls.length=0;assert.equal(gratitude.getDefaultHouseholdId(),undefined);assert.deepEqual(calls,['default']);
  const failure=new Error('synthetic display getter');Object.defineProperty(profile,'display_name',{get(){throw failure;}});
  calls.length=0;assert.throws(()=>gratitude.getHouseholdUsers(),error=>error===failure);
  assert.deepEqual(calls,[['users',undefined],['profile','alex']]); // group label must not be read after the failing name.
});
test('CASE-HOUSEHOLD-PROJECTION-TIMESTAMP Gratitude UTC fallback uses the existing household-default clock rather than UTC formatting',()=>{
  mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-05T12:00:00.000Z')});
  try{
    let timezone='UTC';const {gratitude}=householdProjectionFixture({getDefaultHouseholdId:()=> 'audit-household',getHouseholdTimezone:()=>timezone});
    assert.equal(gratitude.generateTimestamp(),'2026-09-05 05:00:00');
    timezone='';assert.equal(gratitude.getTimezone(),'UTC');assert.equal(gratitude.generateTimestamp(),'2026-09-05 05:00:00');
    timezone='Asia/Tokyo';assert.equal(gratitude.generateTimestamp(),'9/5/2026, 9:00:00 PM');
    timezone='Invalid/AuditZone';assert.throws(()=>gratitude.generateTimestamp(),RangeError);
  }finally{mock.timers.reset();}
});
test('CASE-HOUSEHOLD-PROJECTION-RELOAD presentation observes explicit profile refresh but does not read fresh disk itself',()=>{
  const f=profileFixture(),{gratitude}=householdProjectionFixture(f.config),before=gratitude.getHouseholdUsers();
  assert.equal(before[0].name,'Before');assert.equal(gratitude.resolveDisplayName('audit-user'),'Before');
  const changed={...f.profile,display_name:'After',group_label:'Updated group'};assert.equal(f.data.user.write('profile',changed,'audit-user'),true);
  assert.equal(gratitude.getHouseholdUsers()[0].name,'Before');assert.equal(gratitude.resolveDisplayName('audit-user'),'Before');
  f.config.reloadUserProfile('audit-user');assert.equal(gratitude.getHouseholdUsers()[0].name,'After');
  assert.equal(gratitude.resolveDisplayName('audit-user'),'Updated group');assert.equal(before[0].name,'Before');
  f.config.getHouseholdUsers().push('missing-profile');
  assert.deepEqual(gratitude.getHouseholdUsers().map(u=>u.id),['audit-user','missing-profile']);
});
test('CASE-HOUSEHOLD-PROJECTION-HTTP-ORDER bootstrap waits before projecting users and retains response spread precedence',async()=>{
  let release,reached;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{reached=resolve;});
  const calls=[],outer=application();outer.use('/api/v1/gratitude',createGratitudeRouter({logger,
    gratitudeService:{bootstrap(hid){calls.push(['bootstrap',hid]);reached();return pending;}},
    gratitudeHouseholdService:{getDefaultHouseholdId(){calls.push(['default']);return 'audit-household';},
      getHouseholdUsers(hid){calls.push(['users',hid]);return [{id:'directory-user'}];}}}));
  const request=wireRequest(outer,'GET','/api/v1/gratitude/bootstrap?household=');await entered;
  assert.deepEqual(calls,[['default'],['bootstrap','audit-household']]);
  release({users:[{id:'service-user'}],_household:'service-household',extra:'retained'});
  const result=await request;assert.equal(result.status,200);
  assert.deepEqual(result.json(),{users:[{id:'service-user'}],_household:'audit-household',extra:'retained'});
  assert.deepEqual(calls.at(-1),['users','audit-household']);
  calls.length=0;const users=await wireRequest(outer,'GET','/api/v1/gratitude/users?household=a&household=b');
  assert.equal(users.status,200);assert.deepEqual(calls,[['users',['a','b']]]);assert.deepEqual(users.json()._household,['a','b']);
});
test('CASE-HOUSEHOLD-PROJECTION-HTTP-FAILURE bootstrap failures precede projection and synchronous user failures reach Express unchanged',async()=>{
  for(const failedAt of ['bootstrap','users']){
    const failure=new Error('synthetic '+failedAt),calls=[],outer=application();
    outer.use('/api/v1/gratitude',createGratitudeRouter({logger,gratitudeService:{async bootstrap(){calls.push('bootstrap');if(failedAt==='bootstrap')throw failure;return {};}},
      gratitudeHouseholdService:{getDefaultHouseholdId:()=> 'audit-household',getHouseholdUsers(){calls.push('users');throw failure;}}}));
    await assert.rejects(wireRequest(outer,'GET','/api/v1/gratitude/bootstrap'),error=>error===failure);
    assert.deepEqual(calls,failedAt==='bootstrap'?['bootstrap']:['bootstrap','users']);
    calls.length=0;await assert.rejects(wireRequest(outer,'GET','/api/v1/gratitude/users'),error=>error===failure);assert.deepEqual(calls,['users']);
  }
});

async function orderedFeed(run){
  const random=Math.random;
  // Stable comparator ties retain input order; never a proposed shuffle repair.
  Math.random=()=>0.5;
  try{return await run();}finally{Math.random=random;}
}
test('CASE-GR-FEED-SAMPLE-ORDER unselected invalid rows are untouched and selection finishes before the returned promise settles',()=>orderedFeed(async()=>{
  const rows=[{item:{text:'first'},userId:'audit-user',datetime:'2026-01-01'},null],warnings=[],calls=[];
  const adapter=new GratitudeFeedAdapter({dataService:{household:{read(...args){calls.push(['read',...args]);return rows;}}},
    userService:{resolveGroupLabel(id){calls.push(['name',id]);return 'Group';}},logger:{warn:(...args)=>warnings.push(args)}});
  const pending=adapter.fetchItems({limit:1},'ignored-user');
  assert.deepEqual(calls,[['read','gratitude/selections.gratitude.yml'],['name','audit-user']]);
  const result=await pending;
  assert.deepEqual(result[0].meta.items,[{text:'first',userId:'audit-user',displayName:'Group'}]);
  assert.deepEqual(warnings,[]);assert.equal(rows[1],null);
  assert.deepEqual(await adapter.fetchItems({limit:2}),[]);
  assert.deepEqual(warnings,[['gratitude.adapter.error',{error:"Cannot read properties of null (reading 'item')"}]]);
}));
test('CASE-GR-FEED-FIELD-PRECEDENCE legacy truthiness types and picked lexical timestamps are retained',()=>orderedFeed(async()=>{
  const payload={not:'a string'},names=[];
  const rows=[{item:{text:0},text:'top-level',userId:0,datetime:'2026-01-01'},
    {item:'legacy',userId:'audit-user',datetime:'z-not-an-iso-date'},
    {item:{text:payload},userId:7,datetime:''},{text:'unpicked',datetime:'zz-newest'}];
  const adapter=new GratitudeFeedAdapter({dataService:{household:{read:()=>rows}},
    userService:{resolveGroupLabel(id){names.push(id);return id===7?'':undefined;}},logger});
  const [bundle]=await adapter.fetchItems({limit:3});
  assert.deepEqual(bundle.meta.items,[{text:'top-level',userId:null,displayName:''},
    {text:'legacy',userId:'audit-user',displayName:undefined},{text:payload,userId:7,displayName:''}]);
  assert.equal(bundle.meta.items[2].text,payload);assert.equal(bundle.body,'top-level');
  assert.equal(bundle.timestamp,'z-not-an-iso-date');assert.deepEqual(names,['audit-user',7]);
  assert.equal(Object.hasOwn(bundle.meta.items[1],'displayName'),true);
  const withoutDirectory=new GratitudeFeedAdapter({dataService:{household:{read:()=>[rows[1]]}},logger});
  assert.equal((await withoutDirectory.fetchItems({}))[0].meta.items[0].displayName,'audit-user');
}));
test('CASE-GR-FEED-ERROR-ORDER display errors precede later invalid rows and logging failures are not swallowed',()=>orderedFeed(async()=>{
  let timestampReads=0;const warnings=[],nameFailure=new Error('synthetic name lookup');
  const first={item:{text:'first'},userId:'audit-user',get datetime(){timestampReads++;throw new Error('timestamp must be later');}};
  const adapter=new GratitudeFeedAdapter({dataService:{household:{read:()=>[first,null]}},
    userService:{resolveGroupLabel(){throw nameFailure;}},logger:{warn:(...args)=>warnings.push(args)}});
  assert.deepEqual(await adapter.fetchItems({limit:2}),[]);assert.equal(timestampReads,0);
  assert.deepEqual(warnings,[['gratitude.adapter.error',{error:nameFailure.message}]]);
  const logFailure=new Error('synthetic logging failure');
  const failingLog=new GratitudeFeedAdapter({dataService:{household:{read(){throw new Error('synthetic read failure');}}},
    logger:{warn(){throw logFailure;}}});
  await assert.rejects(failingLog.fetchItems({}),error=>error===logFailure);
  const withoutWarning=new GratitudeFeedAdapter({dataService:{household:{read(){throw new Error('synthetic read failure');}}},logger:{}});
  assert.deepEqual(await withoutWarning.fetchItems({}),[]);
  const sparse=new GratitudeFeedAdapter({dataService:{household:{read:()=>new Array(1)}},logger:{warn:(...args)=>warnings.push(args)}});
  assert.deepEqual(await sparse.fetchItems({}),[]);
  assert.equal(warnings.at(-1)[1].error,"Cannot read properties of undefined (reading 'item')");
}));
test('CASE-GR-FEED-QUERY-ORDER read happens before query access and empty-bundle timestamp is independent from ID clock',()=>orderedFeed(async()=>{
  const events=[],warnings=[];let rows=null;
  const household={read(...args){assert.equal(this,household);events.push(['read',...args]);return rows;}};
  const adapter=new GratitudeFeedAdapter({dataService:{household},logger:{warn:(...args)=>warnings.push(args)}});
  assert.deepEqual(await adapter.fetchItems(null,'not-a-household-selector'),[]);assert.deepEqual(warnings,[]);
  rows=[];assert.deepEqual(await adapter.fetchItems(null),[]);
  assert.equal(warnings.at(-1)[1].error,"Cannot read properties of null (reading 'limit')");
  const now=Date.now;Date.now=()=>{events.push(['id-clock']);return 123456789;};
  try{
    const before=new Date().toISOString();
    const [bundle]=await adapter.fetchItems({get limit(){events.push(['limit']);return 1;},
      get tier(){events.push(['tier']);return 'selected-tier';},get priority(){events.push(['priority']);return 2;}});
    assert.equal(bundle.id,'gratitude:bundle:123456789');assert.equal(bundle.tier,'selected-tier');assert.equal(bundle.priority,2);
    assert.ok(bundle.timestamp>=before&&bundle.timestamp<=new Date().toISOString());
    assert.deepEqual(events.slice(-5),[['read','gratitude/selections.gratitude.yml'],['limit'],['id-clock'],['tier'],['priority']]);
  }finally{Date.now=now;}
}));
test('CASE-GR-FEED-PAGE-CONTRACT inherited paging and read-state remain source-level no-ops',()=>orderedFeed(async()=>{
  let reads=0;const adapter=new GratitudeFeedAdapter({dataService:{household:{read(){reads++;return [];}}},logger});
  const page=await adapter.fetchPage({},'ignored-user',{cursor:'ignored-cursor'});
  assert.equal(page.cursor,null);assert.equal(page.items.length,1);assert.equal(reads,1);
  assert.equal(adapter.sourceType,'gratitude');assert.deepEqual(adapter.provides,['gratitude']);assert.equal(adapter.supportsMarkRead,false);
  assert.equal(await adapter.getDetail('anything',{},'ignored-user'),null);
  assert.equal(await adapter.markRead(['anything'],'ignored-user'),undefined);assert.equal(reads,1);
}));

function profileFixture(){
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(process.env.PRE_RUN_ROOT),'profile-authority-'));
  const profile={username:'audit-user',household_id:'audit-household',display_name:'Before',roles:['member'],
    identities:{telegram:{user_id:'old-platform-id'},fingerprints:[]}};
  const household={_folderName:'household',head:'audit-user',users:['audit-user']};
  const config=new ConfigService({system:{dataDir:directory,defaultHouseholdId:'audit-household'},
    households:{'audit-household':household},users:{'audit-user':structuredClone(profile)},
    identityMappings:{telegram:{'old-platform-id':'audit-user'}}});
  const data=new DataService({configService:config});
  assert.equal(data.user.write('profile',profile,'audit-user'),true);
  assert.equal(data.household.write('household',household),true);
  const store=new YamlAdminConfigStore({dataRoot:directory});
  return {directory,config,data,store,profile,admin:new HouseholdAdminService({configStore:store,logger}),
    users:new ConfigUserDirectory(config,{logger}),accounts:new DataServiceAuthAccountRepository({dataService:data,configService:config})};
}
test('CASE-GR-SNAPSHOT-FILES malformed files remain listed and latest selection does not search for a valid fallback',async()=>{
  const f=profileFixture(),store=new YamlGratitudeDatastore({dataService:f.data,logger});
  const householdId='audit-household',older='20260101_010101_old',newer='20260102_020202_broken';
  assert.deepEqual(await store.listSnapshots(householdId),[]);
  assert.equal(await store.loadSnapshot(householdId),null);
  const record={id:'provided-id',createdAt:'synthetic-date',options:{gratitude:[]}};
  assert.equal(f.data.household.write(`gratitude/snapshots/${older}.yml`,record,householdId),true);
  const snapshotDirectory=path.join(f.directory,'household/gratitude/snapshots');
  fs.writeFileSync(path.join(snapshotDirectory,newer+'.yml'),'value: [unterminated');
  assert.deepEqual(await store.listSnapshots(householdId),[
    {file:newer,id:'020202_broken',createdAt:null,name:newer},
    {file:older,id:'provided-id',createdAt:'synthetic-date',name:older}
  ]);
  assert.equal(await store.loadSnapshot(householdId),null);
  assert.equal(await store.loadSnapshot(householdId,'absent-id'),null);
  // ID matching is a filename substring, not the stored record's id.
  assert.equal(await store.loadSnapshot(householdId,'provided-id'),null);
  assert.deepEqual(await store.loadSnapshot(householdId,'_old'),{...record,file:older});
  assert.deepEqual(f.data.household.read(`gratitude/snapshots/${older}.yml`,householdId),record);
});
test('CASE-GR-TEMP-CONTRACT adapter identity bytes options and printer result survive the temporary-file bridge',async()=>{
  assert.equal(DefaultImagePrintGateway,TemporaryImagePrintGateway);
  let clockCalls=0,observed;
  const gateway=new TemporaryImagePrintGateway({clock:()=>{clockCalls++;return 'audit-print-contract';}});
  assert.ok(gateway instanceof IImagePrintGateway);
  const buffer=Buffer.from([0,1,254,255]),options={width:10,height:20,custom:{retain:true}};
  for(const result of [{accepted:'synthetic'},false,undefined]){
    const job={synthetic:'print-job'};
    const printer={createImagePrint(file,actualOptions){
      observed=file;
      assert.equal(path.basename(file),'gratitude_card_audit-print-contract.png');
      assert.equal(fs.realpathSync(path.dirname(file)),fs.realpathSync(process.env.PRE_RUN_ROOT));
      assert.deepEqual(fs.readFileSync(file),buffer);
      assert.deepEqual(actualOptions,options);assert.equal(actualOptions.custom,options.custom);
      return job;
    },async print(actualJob){assert.equal(actualJob,job);assert.equal(fs.existsSync(observed),true);return result;}};
    assert.equal(await gateway.print(printer,{buffer,...options}),result);
    assert.equal(fs.existsSync(observed),false);
  }
  const failure=new Error('synthetic job-construction failure');
  await assert.rejects(gateway.print({createImagePrint(file){observed=file;throw failure;},
    print(){assert.fail('printer must not run after job construction throws');}},{buffer}),error=>error===failure);
  assert.equal(fs.existsSync(observed),false);assert.equal(clockCalls,4);
});
test('CASE-STORE-PROFILE-ADMIN-LIFETIME Admin changes fresh disk but leaves cached profile and roster intact',()=>{
  const f=profileFixture();
  const updated=f.admin.updateMember('audit-user',{username:'ignored-rename',display_name:'After',roles:['synthetic-role'],extra:{kept:true}});
  assert.equal(updated.username,'audit-user');assert.deepEqual(updated.roles,['synthetic-role']);
  assert.equal(f.data.user.read('profile','audit-user').display_name,'After');
  assert.equal(f.users.getProfile('audit-user').display_name,'Before');
  assert.deepEqual(f.admin.deleteMember('audit-user'),{username:'audit-user'});
  assert.deepEqual(f.store.readHousehold().users,[]);
  assert.equal(f.store.readMemberProfile('audit-user').display_name,'After');
  assert.equal(f.users.getHouseholdRoster()[0].name,'Before');
  assert.throws(()=>f.admin.updateMember('../escape',{}),/Invalid username format/);
});
test('CASE-STORE-PROFILE-FINGERPRINT-CACHE explicit refresh updates profile but not previously returned values or platform index',async()=>{
  const f=profileFixture(),oldProfile=f.config.getUserProfile('audit-user'),oldMap=f.config.getAllUserProfiles();
  f.data.user.write('profile',{...f.profile,identities:{telegram:{user_id:'new-platform-id'},fingerprints:[]}},'audit-user');
  const writer=createFingerprintProfileWriter({datastore:new YamlUserProfileDatastore({configService:f.config}),
    profileCache:{refresh:username=>f.config.reloadUserProfile(username)}});
  await writer.addFingerprint('audit-user',{id:'synthetic-template',finger:'left-index',enrolled:'synthetic-date'});
  assert.deepEqual(f.config.getUserProfile('audit-user').identities.fingerprints,[{id:'synthetic-template',finger:'left-index',enrolled:'synthetic-date'}]);
  assert.deepEqual(oldProfile.identities.fingerprints,[]);assert.equal(oldMap.get('audit-user'),oldProfile);
  assert.equal(f.config.resolveUsername('telegram','old-platform-id'),'audit-user');
  assert.equal(f.config.resolveUsername('telegram','new-platform-id'),null);
  // A malformed profile is collapsed to null and deletes the cached entry.
  fs.writeFileSync(path.join(f.directory,'users/audit-user/profile.yml'),'value: [unterminated');
  assert.equal(f.config.reloadUserProfile('audit-user'),null);assert.equal(f.config.getUserProfile('audit-user'),null);
  assert.equal(f.config.resolveUsername('telegram','old-platform-id'),'audit-user');
});
test('CASE-STORE-PROFILE-FINGERPRINT-FAILURE save failure prevents refresh but refresh failure does not undo save',async()=>{
  const calls=[],failure=new Error('synthetic save failure');
  const failSave=createFingerprintProfileWriter({datastore:{readProfile:()=>({}),writeProfile:()=>{calls.push('save');throw failure;}},
    profileCache:{refresh:()=>calls.push('refresh')}});
  await assert.rejects(failSave.addFingerprint('audit-user',{id:'a'}),error=>error===failure);
  assert.deepEqual(calls,['save']);let persisted;
  const failRefresh=createFingerprintProfileWriter({datastore:{readProfile:()=>({}),writeProfile:(_user,value)=>{persisted=value;}},
    profileCache:{refresh:()=>{throw new Error('synthetic refresh failure');}}});
  await assert.rejects(failRefresh.addFingerprint('audit-user',{id:'b'}),/synthetic refresh failure/);
  assert.equal(persisted.identities.fingerprints[0].id,'b');
});
test('CASE-STORE-PROFILE-AUTH-MIXED-READS account reads are fresh but enumeration and invite lookup use cached profiles',()=>{
  const f=profileFixture();
  f.data.user.write('profile',{...f.profile,display_name:'Fresh disk',roles:['fresh-role']},'audit-user');
  f.data.user.write('auth/login',{password_hash:'synthetic-digest',invite_token:'synthetic-invite'},'audit-user');
  assert.equal(f.accounts.getAccount('audit-user').displayName,'Fresh disk');
  assert.equal(f.accounts.listAccounts()[0].displayName,'Before');
  assert.equal(f.accounts.listAccounts()[0].passwordDigest,'synthetic-digest');
  assert.equal(f.accounts.findInvite('synthetic-invite').displayName,'Before');
  f.accounts.acceptInvite('audit-user',{passwordDigest:'changed-digest',displayName:'Accepted',authenticatedAt:'synthetic-date'});
  assert.equal(f.accounts.getAccount('audit-user').displayName,'Accepted');
  assert.equal(f.accounts.listAccounts()[0].displayName,'Before');
  assert.equal(f.accounts.findInvite('synthetic-invite'),null);
  f.data.user.write('profile',{username:'disk-only'},'disk-only');
  assert.equal(f.accounts.getAccount('disk-only').username,'disk-only');
  assert.deepEqual(f.accounts.listAccounts().map(account=>account.username),['audit-user']);
});
test('CASE-STORE-PROFILE-AUTH-PARTIAL-WRITES setup ignores false write results and does not pass household ID to household write',()=>{
  const calls=[];
  const dataService=Object.fromEntries(['user','household','system'].map(scope=>[scope,{write:(...args)=>{calls.push([scope,...args]);return false;}}]));
  const repo=new DataServiceAuthAccountRepository({dataService,configService:{}});
  assert.equal(repo.createOwner({username:'audit-owner',householdId:'requested-household',householdName:'Synthetic',
    passwordDigest:'synthetic',authenticatedAt:'synthetic-date',authenticationConfiguration:{synthetic:true}}),undefined);
  assert.deepEqual(calls.map(([scope,key])=>[scope,key]),[['user','profile'],['user','auth/login'],['household','household'],['system','config/auth']]);
  assert.equal(calls[2].length,3);assert.equal(calls[2][2].household_id,'requested-household');
  const done=[];dataService.user.write=(...args)=>{done.push(args[0]);if(args[0]==='auth/login')throw new Error('synthetic second write');};
  assert.throws(()=>repo.createOwner({username:'audit-owner'}),/synthetic second write/);
  assert.deepEqual(done,['profile','auth/login']);assert.equal(calls.length,4);
});
test('CASE-STORE-PROFILE-ADMIN-CREATE-FAILURE failed roster write leaves the already persisted member profile',()=>{
  const calls=[];let saved;
  const admin=new HouseholdAdminService({logger,configStore:{readHousehold:()=>({users:[]}),
    writeMemberProfile:(username,value)=>{calls.push(['profile',username]);saved=value;},
    writeHousehold:()=>{calls.push(['household']);throw new Error('synthetic roster failure');}}});
  assert.throws(()=>admin.createMember({username:'../escape'}),/alphanumeric/);assert.deepEqual(calls,[]);
  assert.throws(()=>admin.createMember({username:'audit-new',display_name:'New'}),/synthetic roster failure/);
  assert.equal(saved.username,'audit-new');assert.equal(saved.household_id,'default');
  assert.deepEqual(calls,[['profile','audit-new'],['household']]);
});

function biometricFixture(){
  const broadcasts=[],timers=new Map();let listener,id=0,timer=0;
  const eventBus={broadcast:(topic,payload)=>{broadcasts.push({topic,payload});return 0;},onClientMessage:fn=>{listener=fn;return()=>{listener=null;};}};
  const gateway=new EventBusBiometricGateway({eventBus,logger,idFn:()=>`audit-request-${++id}`,
    setTimer:(fn,ms)=>{const key=++timer;timers.set(key,{fn,ms});return key;},clearTimer:key=>timers.delete(key)});
  return {gateway,broadcasts,timers,deliver:message=>listener('untrusted-synthetic-client',message),expire:()=>[...timers.values()][0].fn()};
}
test('CASE-WIRE-FITNESS-BIOMETRIC-PROJECTION request IDs and client progress tokens have distinct projections',async()=>{
  const f=biometricFixture();const candidates=[{uuid:'template-a',username:'learner-a'}];
  const unlock=f.gateway.requestUnlock('admin',candidates);
  assert.deepEqual(f.broadcasts[0],{topic:'fitness.unlock.request',payload:{requestId:'audit-request-1',lockName:'admin',candidateUuids:candidates}});
  assert.equal([...f.timers.values()][0].ms,15000);
  f.deliver({topic:'fitness.unlock.result',requestId:'audit-request-1',matched:0,reason:'reader-busy',uuid:'discard'});
  assert.deepEqual(await unlock,{matched:false,userId:undefined});assert.equal(f.timers.size,0);
  const enroll=f.gateway.requestEnroll({finger:'left-index',username:'learner-a',clientToken:'ui-token'});
  assert.deepEqual(f.broadcasts[1],{topic:'fitness.enroll.request',payload:{requestId:'audit-request-2',finger:'left-index',username:'learner-a'}});
  f.deliver({topic:'fitness.enroll.progress',requestId:'audit-request-2',stage:2,stagesTotal:6});
  assert.deepEqual(f.broadcasts[2],{topic:'fitness.enroll.progress',payload:{clientToken:'ui-token',stage:2,stagesTotal:6}});
  f.deliver({topic:'fitness.enroll.result',requestId:'audit-request-2',success:false,error:'duplicate',matchedUuid:'existing-template'});
  assert.deepEqual(await enroll,{success:false,error:'duplicate',matchedUuid:'existing-template'});assert.equal(f.timers.size,0);
  const deletion=f.gateway.requestDelete({uuid:'template-a'});
  f.deliver({topic:'fitness.fingerprint.delete.result',requestId:'audit-request-3',success:false});
  assert.deepEqual(await deletion,{success:false,error:'delete-failed'});assert.equal(f.timers.size,0);
});
test('CASE-WIRE-FITNESS-BIOMETRIC-CORRELATION current gateway keys settlement only by request ID and keeps timeout distinct',async()=>{
  const f=biometricFixture();const pending=f.gateway.requestDelete({uuid:'template-a'});
  f.deliver({topic:'fitness.unlock.result',requestId:1,matched:true});assert.equal(f.timers.size,1);
  f.deliver({topic:'fitness.unlock.result',requestId:'unknown',matched:true});assert.equal(f.timers.size,1);
  // An unexpected result kind/client is currently not tied to the pending operation.
  f.deliver({topic:'fitness.unlock.result',requestId:'audit-request-1',source:'not-fitness',matched:'false',userId:'projected-user'});
  assert.deepEqual(await pending,{matched:true,userId:'projected-user'});assert.equal(f.timers.size,0);
  const timed=f.gateway.requestUnlock('admin',[],{timeoutMs:-1});assert.equal([...f.timers.values()][0].ms,-1);
  assert.equal(f.broadcasts.length,2);f.expire();assert.deepEqual(await timed,{matched:false,reason:'timeout'});assert.equal(f.timers.size,0);
  f.deliver({topic:'fitness.unlock.result',requestId:'audit-request-2',matched:true,userId:'late'});assert.equal(f.timers.size,0);
});
test('CASE-WIRE-FITNESS-SCAN-POLICY continuous scan distinguishes touch events from absent templates and reader faults',async()=>{
  const results=[{matched:true,uuid:'template-a'},{matched:false,reason:'no-match'},
    {reason:'no-templates'},{reason:'cancelled'},{reason:'identify-error'},
    {reason:'identify-error',error:'reader overheat'},{matched:true,uuid:'template-b'}];
  const sent=[],delays=[];let i=0;
  const loop=createContinuousScanLoop({runScan:async()=>({ok:true,value:results[i++]}),sendBus:(topic,payload)=>{sent.push({topic,payload});return false;},
    delay:async ms=>{delays.push(ms);},logger,maxIterations:results.length});
  await loop.run();loop.stop();assert.equal(i,results.length);
  assert.deepEqual(sent,[{topic:'biometric.scan',payload:{modality:'fingerprint',matched:true,uuid:'template-a'}},
    {topic:'biometric.scan',payload:{modality:'fingerprint',matched:false}},
    {topic:'biometric.scan',payload:{modality:'fingerprint',matched:true,uuid:'template-b'}}]);
  assert.deepEqual(delays,[1500,1500,5000,800,800,30000,1500]);
  assert.equal(faultBackoffMs(1),800);assert.equal(faultBackoffMs(7),30000);
});
test('CASE-WIRE-FITNESS-HR-ENCODING BLE packets retain the existing ant-compatible HR envelope',()=>{
  const decoder=new BleHeartRateDecoder();
  assert.equal(decoder.processPacket([1,60]),null);assert.equal(decoder.processPacket([0,49]),null);
  assert.equal(decoder.processPacket([0,231]),null);
  const value=decoder.processPacket([7,60,0]);assert.equal(value.hr,60);assert.equal(value.sensorContact,true);
  const message=decoder.formatForWebSocket('learner-a');
  assert.deepEqual({...message,timestamp:'<receipt-clock>'},{topic:'fitness',source:'fitness',type:'ant',profile:'HR',deviceId:'ble_learner-a',timestamp:'<receipt-clock>',data:{ComputedHeartRate:60,sensorContact:true,source:'ble'}});
  assert.match(message.timestamp,/^\d{4}-\d\d-\d\dT/);decoder.reset();assert.equal(decoder.lastHR,0);assert.equal(decoder.lastPacketTime,null);
});
test('CASE-WIRE-SCHOOLCALC-AUTH exact Bearer credentials bind relay identity before the downstream handler',async()=>{
  const token='synthetic-relay-token-not-a-secret-0001';
  const credentialVerifier=new SchoolCalcRelayCredentialVerifier({credentials:[{relayId:'audit-relay',apiToken:token}]});
  const app=application();let calls=0;
  app.use(createSchoolCalcIngressAuthenticator({credentialVerifier,logger}));
  app.get('/probe',(req,res)=>{calls++;assert.equal(Object.isFrozen(req.schoolCalcIngress),true);res.json(req.schoolCalcIngress);});
  for(const headers of [{},{authorization:`bearer ${token}`},{authorization:`Bearer  ${token}`},
    {authorization:`Bearer ${token}`,'x-schoolcalc-relay-id':'different-relay'}]){
    const response=await wireRequest(app,'GET','/probe',{headers});assert.equal(response.status,401);assert.deepEqual(response.json(),{error:'unauthorized'});
  }
  assert.equal(calls,0);
  for(const headers of [{authorization:`Bearer ${token}`},{authorization:`Bearer ${token}`,'x-schoolcalc-relay-id':'audit-relay'}]){
    const response=await wireRequest(app,'GET','/probe',{headers});assert.equal(response.status,200);assert.deepEqual(response.json(),{id:'audit-relay'});
  }
  assert.equal(calls,2);assert.throws(()=>new SchoolCalcRelayCredentialVerifier({credentials:[{relayId:'audit-relay',apiToken:'short'}]}),/at least 32 bytes/);
  assert.throws(()=>new SchoolCalcRelayCredentialVerifier({credentials:[{relayId:'audit-relay',apiToken:token},{relayId:'another-relay',apiToken:token}]}),/distinct api_token/);
});
test('CASE-WIRE-SCHOOLCALC-SYNC original orchestration orders effects and acknowledges only this uploaded batch',async()=>{
  const calls=[];const operation=(name,value)=>({execute:async input=>{calls.push({name,input});return value;}});
  const profiles={record:Buffer.from('profile')},progress={record:Buffer.from('progress')};
  const results={outcomes:[{sequence:4,acknowledge:true},{sequence:5,acknowledge:false},{sequence:6,acknowledge:1}]};
  const deliveries={requests:[{requestId:2,acknowledge:true},{requestId:3,acknowledge:false}]};
  const interaction={record:Buffer.from('turn')},study={resolved:true},plan={ready:true};
  const sync=new SyncSchoolCalcDevice({profiles:operation('profiles',profiles),observe:operation('observe',{}),importQueue:operation('results',results),
    requests:operation('deliveries',deliveries),interactions:operation('interaction',interaction),studies:operation('study',study),progress:operation('progress',progress),plan:operation('plan',plan)});
  const input={deviceId:'AUDIT1',relayId:'audit-relay',rawInfo:Buffer.from('info'),rawState:Buffer.from('state'),resultQueue:Buffer.from('queue'),
    requestRecord:Buffer.from('request'),interactionRecord:Buffer.from('interaction'),studyEntry:Buffer.from('study'),catalogGeneration:'generation-a'};
  const result=await sync.execute(input);assert.deepEqual(calls.map(v=>v.name),['profiles','observe','results','deliveries','interaction','study','progress','plan']);
  assert.equal(calls[2].input.record,input.resultQueue);assert.deepEqual(calls.at(-1).input,{deviceId:'AUDIT1',catalogGeneration:'generation-a',acknowledgementSequences:[4],
    deliveryAcknowledgementIds:[2],queueRecordBytes:5,profileRecordBytes:7,progressRecordBytes:8,interactionResponseBytes:4});
  assert.equal(result.study,study);assert.equal(result.plan,plan);
});
test('CASE-WIRE-SCHOOLCALC-SYNC-FAILURE a late failed stage stops following work but does not roll back earlier effects',async()=>{
  const calls=[];const success=name=>({execute:async()=>{calls.push(name);return{record:Buffer.from(name)};}});
  const sync=new SyncSchoolCalcDevice({profiles:success('profiles'),observe:success('observe'),importQueue:success('results'),
    requests:{execute:async()=>{calls.push('deliveries');throw new Error('synthetic delivery failure');}},progress:success('progress'),plan:success('plan')});
  await assert.rejects(sync.execute({deviceId:'AUDIT1',rawInfo:Buffer.from('info'),resultQueue:Buffer.from('queue'),requestRecord:Buffer.from('request')}),/synthetic delivery failure/);
  assert.deepEqual(calls,['profiles','observe','results','deliveries']);
});
test('CASE-WIRE-TI86-STRING-FILE transfer wrapper preserves exact record bytes without validating their SchoolCalc envelope',()=>{
  const record=Buffer.from([0,255,17,35]);const file=createTi86StringFile({name:'dsq',record,comment:'audit'});
  assert.equal(file.subarray(0,8).toString(),'**TI86**');assert.equal(file.readUInt16LE(53),22);
  const entry=file.subarray(55,-2);assert.equal(entry.readUInt16LE(0),12);assert.equal(entry.readUInt16LE(2),6);
  assert.equal(entry[4],12);assert.equal(entry[5],3);assert.equal(entry.subarray(6,9).toString(),'DSQ');
  assert.equal(entry.readUInt16LE(14),6);assert.equal(entry.readUInt16LE(16),record.length);assert.deepEqual(entry.subarray(18),record);
  assert.equal(file.readUInt16LE(file.length-2),[...entry].reduce((sum,byte)=>(sum+byte)&65535,0));
  assert.throws(()=>createTi86StringFile({name:'../dsq',record}),/invalid TI-86 String name/);
  assert.throws(()=>createTi86StringFile({name:'DSQ',record:new Uint8Array(record)}),/invalid TI-86 String record/);
});

function hubClient(){
  const calls=[];let response={status:200,data:'{}'},failure=null;
  const adapter=new HttpPlaybackHubAdapter({baseUrl:'https://hub.audit.invalid/',requestTimeoutSec:0.0001,logger,
    httpClient:{requestRaw:async(method,url,options)=>{calls.push({method,url,options});if(failure)throw failure;return response;}}});
  return {adapter,calls,reply:(body,status=200)=>{failure=null;response={status,data:JSON.stringify(body)};},
    raw:value=>{failure=null;response=value;},fail:error=>{failure=error;}};
}
const hubTargets=['red','blue'].map(value=>({color:{value}}));
test('CASE-WIRE-HUB-STATUS slot identity is not playback position and optional idle values stay null',async()=>{
  const h=hubClient();h.reply([{slot:2,position:125,color:'red',bt_connected:true,paused:false,extra:'discard'}]);
  const [status]=await h.adapter.getStatus();assert.equal(status.position,2);assert.equal(status.color,'red');
  assert.equal(status.now_playing,null);assert.equal(status.volume,null);assert.equal(status.playlist_pos,null);
  assert.equal(status.playlist_count,null);assert.equal(status.armed_source,null);assert.equal(status.extra,undefined);
  assert.deepEqual(h.calls,[{method:'GET',url:'https://hub.audit.invalid/api/status',options:{body:null,headers:{Accept:'application/json'},responseType:'text',timeout:1}}]);
  h.reply([{slot:2,color:'red',bt_connected:1,paused:false}]);
  await assert.rejects(h.adapter.getStatus(),error=>error.code==='INVALID_SLOT_STATUS');
  h.reply({slots:[]});await assert.rejects(h.adapter.getStatus(),error=>error.code==='HUB_BAD_RESPONSE');
  h.reply([null]);await assert.rejects(h.adapter.getStatus(),error=>error.code==='HUB_BAD_RESPONSE');
});
test('CASE-WIRE-HUB-COMMAND queue prefixes zero options and numeric legacy results preserve their current projection',async()=>{
  const h=hubClient();h.reply({ok:false,applied:1,skipped:1});
  const r=await h.adapter.sendCommand({action:'play',queue:{source:'plex',id:'queue-a'},volume:0,durationMin:0,resumePrevious:true},hubTargets);
  assert.deepEqual(h.calls[0].options.body,{action:'play',target:'red,blue',content_id:'queue-a',volume:0,duration_min:0});
  assert.deepEqual(r.applied,['red','blue']);assert.deepEqual(r.skipped,[]);assert.equal(r.allApplied(),true);
  h.reply({applied:0,skipped:1});const rejected=await h.adapter.sendCommand({action:'play',queue:{source:'spotify',id:'track-a'}},hubTargets);
  assert.deepEqual(h.calls[1].options.body,{action:'play',target:'red,blue',content_id:'spotify:track-a'});
  assert.deepEqual(rejected.skipped,[{color:'red',reason:'invalid-target'},{color:'blue',reason:'invalid-target'}]);
  const before=h.calls.length;await assert.rejects(h.adapter.sendCommand({action:'stop'},[]),e=>e.code==='INVALID_TARGETS');assert.equal(h.calls.length,before);
});
test('CASE-WIRE-HUB-RESULT modern reasons contention and verification retain distinct response rules',async()=>{
  const h=hubClient();h.reply({ok:false,applied:['outside-target','',9],skipped:[null,{color:'red',reason:'future-reason'},{color:'blue',reason:'unreachable'},{reason:'not-found'}]});
  const r=await h.adapter.sendCommand({action:'stop'},hubTargets);
  assert.deepEqual(r.applied,['outside-target','']);assert.deepEqual(r.skipped,[{color:'red',reason:'invalid-target'},{color:'blue',reason:'unreachable'}]);
  h.raw({status:409,data:'not JSON'});const contention=await h.adapter.sendCommand({action:'stop'},hubTargets);
  assert.deepEqual(contention.applied,[]);assert.deepEqual(contention.skipped,hubTargets.map(d=>({color:d.color.value,reason:'contention'})));
  h.reply({anything:'unchanged'});assert.deepEqual(await h.adapter.verifyAudio('red/blue'),{anything:'unchanged'});
  assert.equal(h.calls.at(-1).url,'https://hub.audit.invalid/api/verify/red%2Fblue');
  h.reply([]);await assert.rejects(h.adapter.verifyAudio('red'),e=>e.code==='HUB_BAD_RESPONSE');
});
test('CASE-WIRE-HUB-ERROR malformed transport data HTTP failures and timeout codes are not interchangeable',async()=>{
  const h=hubClient();
  h.raw({status:200,data:{applied:['red']}});await assert.rejects(h.adapter.sendCommand({action:'stop'},hubTargets),e=>e.code==='HUB_BAD_RESPONSE');
  h.raw({status:503,data:'not JSON'});await assert.rejects(h.adapter.getStatus(),e=>e.code==='HUB_HTTP_ERROR');
  for(const marker of [{code:'TIMEOUT'},{name:'AbortError'},{code:'ABORT_ERR'}]){
    h.fail(Object.assign(new Error('synthetic timeout'),marker));await assert.rejects(h.adapter.getStatus(),e=>e.code==='HUB_TIMEOUT');
  }
  h.fail(new Error('synthetic disconnect'));await assert.rejects(h.adapter.getStatus(),e=>e.code==='HUB_NETWORK_ERROR');
});
test('CASE-WIRE-PIANO-RESET-RESULT HTTP success is not a verified repair and only literal fixed true succeeds',async()=>{
  const requests=[];const call=response=>resetPianoBridge({fetchImpl:async(url,options)=>{requests.push({url,options});return response;}});
  assert.deepEqual(await call({ok:false,status:503}),{ok:false,reason:'http-error',status:503});
  assert.deepEqual(await call({ok:true,json:async()=>{throw new Error('bad JSON');}}),{ok:false,reason:'invalid-response'});
  assert.deepEqual(await call({ok:true,json:async()=>({ok:true,fixed:'true',verdict:{echo:false}})}),{ok:false,reason:'not-fixed',verdict:{echo:false}});
  assert.deepEqual(await call({ok:true,json:async()=>({ok:false,fixed:true})}),{ok:true,reason:'fixed',recoveredAt:null,verdict:null});
  assert.deepEqual(await call({ok:true,json:async()=>({fixed:true,recoveredAt:'L1',verdict:{echo:true},extra:'discard'})}),{ok:true,reason:'fixed',recoveredAt:'L1',verdict:{echo:true}});
  assert.equal(requests.length,5);for(const {url,options} of requests){assert.equal(url,'http://localhost:8770/reset');assert.equal(options.method,'POST');assert.equal(options.signal.aborted,false);}
});
test('CASE-WIRE-PIANO-RESET-FAILURE abort and network errors remain distinct with a real bounded cancel timer',{timeout:5000},async()=>{
  let aborted=0;
  const timed=await resetPianoBridge({timeoutMs:1,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted++;reject(Object.assign(new Error('synthetic cancellation'),{name:'AbortError'}));},{once:true});})});
  assert.equal(aborted,1);assert.deepEqual(timed,{ok:false,reason:'timeout',error:'synthetic cancellation'});
  assert.deepEqual(await resetPianoBridge({fetchImpl:async()=>{throw new Error('synthetic refusal');}}),{ok:false,reason:'unreachable',error:'synthetic refusal'});
});

function firmwareBus(){
  const handlers=new Set(),broadcasts=[],direct=[];
  return {broadcasts,direct,onClientMessage:fn=>{handlers.add(fn);return()=>handlers.delete(fn);},
    broadcast:(topic,payload)=>{broadcasts.push({topic,payload});return 1;},
    sendToClient:(clientId,payload)=>{direct.push({clientId,payload});return true;},
    ingest:frame=>{for(const fn of handlers)fn('synthetic-firmware-client',frame);},subscriptions:()=>handlers.size};
}
test('CASE-WIRE-KITCHEN-DISPATCH real barcode and scale gateways split a shared source and retain legacy frames',()=>{
  const eventBus=firmwareBus(),seen=[];
  const barcode=new BarcodeFirmwareGateway({eventBus,defaultDevice:'fallback-scanner',defaultRoute:'content',timezone:'UTC'});
  const scale=new FoodScaleFirmwareGateway({eventBus,config:{scales:{'synthetic-scale':{topic:'audit-scale'}}},timezone:'UTC'});
  const offBarcode=barcode.subscribe(event=>{seen.push(['barcode',event]);return false;});
  const offScale=scale.subscribe(event=>{seen.push(['scale',event]);return false;});
  eventBus.ingest({source:'kitchen-relay',type:'scan',code:' 012345 ',device:'scanner',route:'nutribot',label:'discard',ts:1,delayed_ms:5000});
  eventBus.ingest({source:'kitchen-relay',type:'scale',id:'synthetic-scale',grams:'12',stable:1,unit:'oz',ts:1});
  eventBus.ingest({source:'kitchen-relay',type:'button',id:'synthetic-scale',press:'unknown'});
  eventBus.ingest({source:'kitchen-relay',type:'hello'});
  eventBus.ingest({source:'barcode-relay',type:'scan',code:'legacy',route:'invalid'});
  eventBus.ingest({source:'food-scale-relay',type:'scale',grams:null});
  eventBus.ingest({source:'barcode-relay',type:'scan',code:123});
  eventBus.ingest({source:'kitchen-relay',type:'scale',grams:'not finite'});
  assert.deepEqual(seen.map(([kind])=>kind),['barcode','scale','scale','barcode','scale']);
  assert.deepEqual(eventBus.broadcasts.map(v=>v.topic),['barcode-relay','audit-scale','audit-scale','barcode-relay','food-scale']);
  const first=seen[0][1];assert.deepEqual({...first,ts:'<receipt-time>'},{source:'barcode-relay',device:'scanner',route:'nutribot',code:'012345',ts:'<receipt-time>'});
  assert.match(first.ts,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.deepEqual({...seen[1][1],ts:null},{id:'synthetic-scale',grams:12,stable:true,unit:'oz',ts:null,source:'ble-relay'});
  assert.equal(seen[2][1].press,'short');assert.equal(Object.hasOwn(seen[2][1],'source'),false);
  assert.equal(seen[3][1].device,'fallback-scanner');assert.equal(seen[3][1].route,'content');
  assert.equal(seen[4][1].grams,0);assert.equal(seen[4][1].id,'unknown');
  offBarcode();offScale();assert.equal(eventBus.subscriptions(),0);
});
test('CASE-WIRE-OMR-NORMALIZE real gateway reconstructs queued read time and validates marks and NFC',t=>{
  const eventBus=firmwareBus(),seen=[];let allow=true;
  t.mock.method(Date,'now',()=>Date.parse('2026-09-06T12:00:00Z'));
  const gateway=new OmrFirmwareGateway({eventBus,config:{scanners:{reader:{topic:'audit-omr'}}},timezone:'UTC'});
  const off=gateway.subscribe((event,metadata)=>{seen.push({event,metadata});return allow;});t.after(off);
  eventBus.ingest({source:'omr-relay',type:'sheet',id:'reader',ageMs:5000,columns:999,markedColumns:999,marks:['2',null,4095]});
  assert.deepEqual(seen[0],{event:{id:'reader',event:'sheet',columns:3,markedColumns:2,marks:[2,0,4095],ts:'2026-09-06 11:59:55',source:'omr-relay'},metadata:{clientId:'synthetic-firmware-client'}});
  assert.equal(eventBus.broadcasts[0].topic,'audit-omr');
  eventBus.ingest({source:'omr-relay',type:'sheet',marks:[4096]});
  eventBus.ingest({source:'omr-relay',type:'sheet',marks:[]});
  eventBus.ingest({source:'omr-relay',type:'nfc',uid:'bad'});assert.equal(seen.length,1);
  allow=false;eventBus.ingest({source:'omr-relay',type:'nfc',id:'reader',uid:' aabbccdd ',atqa:'4',sak:null});
  assert.equal(seen[1].event.uid,'AABBCCDD');assert.equal(seen[1].event.atqa,4);assert.equal(seen[1].event.sak,0);
  assert.equal(eventBus.broadcasts.length,1);
});
test('CASE-WIRE-OMR-ECHO-PERSIST echoed reads precede asynchronous persistence and do not certify a durable write',async t=>{
  const eventBus=firmwareBus(),writes=[],warnings=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const relay=createOmrRelay({relayGateway:new OmrFirmwareGateway({eventBus,timezone:'UTC'}),
    dayLog:{append:async(id,record)=>{writes.push({id,record});await gate;throw new Error('synthetic disk error');}},
    logger:{...logger,warn:(_event,data)=>warnings.push(data)}});t.after(relay.dispose);t.after(()=>release());
  eventBus.ingest({source:'omr-relay',type:'sheet',id:'reader',marks:[1,0,2]});
  assert.equal(eventBus.broadcasts.length,1);assert.equal(writes.length,0);
  await Promise.resolve();assert.equal(writes.length,1);assert.equal(eventBus.broadcasts[0].payload.event,'sheet');
  release();await relay.flush();assert.equal(warnings.length,1);assert.match(warnings[0].error,/synthetic disk error/);
  assert.equal(eventBus.broadcasts.length,1);relay.dispose();assert.equal(eventBus.subscriptions(),0);
});
test('CASE-WIRE-AUTOMOTIVE-ACK real relay accumulates arrival order and acknowledges only after selected writes settle',{timeout:5000},async t=>{
  const eventBus=firmwareBus(),order=[];let saved,release,entered;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const saveEntered=new Promise(resolve=>{entered=resolve;});
  const gateway=new AutomotiveFirmwareGateway({eventBus,timezone:'UTC',now:()=>Date.parse('2026-09-06T12:00:00Z')});
  const relay=createAutomotiveRelay({relayGateway:gateway,timezone:'UTC',logger,
    tripStore:{inspect:async()=>{order.push('inspect');return{exists:false};},save:async(_id,trip)=>{order.push('save');saved=trip;entered();await gate;return'synthetic-trip-reference';}},
    dayLog:{appendAt:async()=>{order.push('log');}}});t.after(relay.dispose);
  const frame={source:'obd-relay',type:'trip',id:'vehicle',trip_id:'trip-a'};
  eventBus.ingest({...frame,seq:9,final:false,samples:[[1000,0,0,0,0,0,-1,13]]});
  eventBus.ingest({...frame,seq:0,final:true,samples:[[2000,0,0,0,0,0,-1,14]],meta:{telemetry_schema:2,clock_synced_at_upload:false}});
  assert.equal(eventBus.broadcasts.length,1);assert.equal(eventBus.direct.length,0);
  await saveEntered;
  assert.deepEqual(order,['inspect','save']);assert.deepEqual(saved.samples.map(v=>v.batt_v),[13,14]);assert.deepEqual(saved.samples.map(v=>v.t),[0,1]);
  assert.equal(saved.meta.time_source,'boot-relative');assert.equal(saved.meta.started,null);assert.equal(eventBus.direct.length,0);
  release();await relay.flush();assert.deepEqual(order,['inspect','save','log']);
  assert.deepEqual(eventBus.direct,[{clientId:'synthetic-firmware-client',payload:{type:'trip-ack',trip_id:'trip-a'}}]);
});
test('CASE-WIRE-AUTOMOTIVE-FAILURE log failure withholds first ack but existing-trip retry bypasses the log',async t=>{
  const eventBus=firmwareBus(),warnings=[];let exists=false,saves=0,logs=0;
  const relay=createAutomotiveRelay({relayGateway:new AutomotiveFirmwareGateway({eventBus,timezone:'UTC'}),timezone:'UTC',
    logger:{...logger,warn:(_event,data)=>warnings.push(data)},
    tripStore:{inspect:async()=>({exists,reference:'synthetic-trip-reference'}),save:async()=>{saves++;exists=true;return'synthetic-trip-reference';}},
    dayLog:{appendAt:async()=>{logs++;throw new Error('synthetic day-log failure');}}});t.after(relay.dispose);
  const frame={source:'obd-relay',type:'trip',id:'vehicle',trip_id:'trip-b',seq:0,final:true,samples:[[1000,0,0,0,0,0,-1,13]]};
  eventBus.ingest(frame);await relay.flush();assert.equal(saves,1);assert.equal(logs,1);assert.equal(eventBus.direct.length,0);assert.equal(warnings.length,1);
  eventBus.ingest(frame);await relay.flush();assert.equal(saves,1);assert.equal(logs,1);assert.equal(eventBus.direct.length,1);
});
test('CASE-WIRE-EINK-CONFIG original router preserves plain-text field order and best-effort telemetry before snapshot',async()=>{
  const calls=[],app=application();
  app.use('/api/v1/eink',createEinkRouter({logger,einkPanelService:{
    recordTelemetry:(id,data)=>{calls.push(['telemetry',id,data]);throw new Error('synthetic telemetry error');},
    stateSnapshot:async id=>{calls.push(['snapshot',id]);return{id:'synthetic panel',rotation:90,buttons:{green:'select',right:'next',left:'prev'},nextWakeSec:120,imageHash:'audit-hash'};}}}));
  const r=await wireRequest(app,'GET','/api/v1/eink/panel-a/config?bat=4000&rssi=-50&up=bad&heap=&psram=12&rst=0&wake=timer');
  assert.equal(r.status,200);assert.match(r.headers['content-type'],/^text\/plain/);assert.equal(r.headers['cache-control'],'no-cache');
  assert.deepEqual(calls,[['telemetry','panel-a',{bat:4000,rssi:-50,psram:12,rst:0,wake:'timer'}],['snapshot','panel-a']]);
  assert.equal(r.body,'id=synthetic panel\nrotation=90\nbtn_green=select\nbtn_right=next\nbtn_left=prev\nnext_wake=120\nimage=/api/v1/eink/synthetic%20panel/panel\nimage_hash=audit-hash\n');
});
test('CASE-WIRE-EINK-PANEL-ACTION panel bypasses conditional freshness and GET action retains side effects',async()=>{
  const calls=[],app=application();
  app.use('/api/v1/eink',createEinkRouter({logger,einkPanelService:{
    renderResult:async id=>{calls.push(['render',id]);return{png:Buffer.from('synthetic-image-bytes')};},
    advance:async(id,action)=>{calls.push(['advance',id,action]);return{view:'reader',index:2};},getTelemetry:()=>null}}));
  const r=await wireRequest(app,'GET','/api/v1/eink/panel-a/panel',{headers:{'if-none-match':'*'}});
  assert.equal(r.status,200);assert.equal(r.body,'synthetic-image-bytes');assert.equal(r.headers['content-type'],'image/png');assert.equal(r.headers.etag,undefined);
  assert.deepEqual((await wireRequest(app,'GET','/api/v1/eink/panel-a/action/next')).json(),{ok:true,view:'reader',index:2});
  assert.deepEqual((await wireRequest(app,'GET','/api/v1/eink/panel-a/status')).json(),{id:'panel-a',reported:false});
  assert.deepEqual(calls,[['render','panel-a'],['advance','panel-a','next']]);
});

test('CASE-WIRE-FINGERPRINT-SHAPES existing profile helpers deliberately retain different optional fields',()=>{
  const prior={id:'prior-id',finger:'left-index'}, profile={name:'Synthetic',identities:{admin:true,fingerprints:[prior]}};
  const before=structuredClone(profile), entry={id:'new-id',finger:'right-index',simulated:true,extra:'not stored'};
  const host=hostProfiles.addFingerprintEntry(profile,entry),central=centralAdd(profile,entry),fitness=fitnessProfiles.addFingerprintEntry(profile,entry);
  assert.deepEqual(profile,before);assert.notEqual(host,profile);assert.notEqual(host.identities,profile.identities);
  assert.notEqual(host.identities.fingerprints,profile.identities.fingerprints);assert.equal(host.identities.fingerprints[0],prior);
  assert.deepEqual(host,central);assert.equal(host.identities.admin,true);
  assert.deepEqual(host.identities.fingerprints[1],{id:'new-id',finger:'right-index',enrolled:undefined});
  assert.equal(Object.hasOwn(host.identities.fingerprints[1],'enrolled'),true);
  assert.deepEqual(fitness.identities.fingerprints[1],{id:'new-id',finger:'right-index',simulated:true});
  assert.equal(Object.hasOwn(fitness.identities.fingerprints[1],'enrolled'),false);
});
test('CASE-WIRE-FINGERPRINT-GALLERY gallery enumeration is not the central last-owner identity index',()=>{
  const profiles={alpha:{identities:{fingerprints:[{id:'same-id',finger:'left'},{id:''},null]}},
    beta:{identities:{fingerprints:[{id:'same-id',finger:'right'},{id:'second-id'}]}}};
  const selected=['beta','missing','alpha','beta'];
  const expected=[{uuid:'same-id',username:'beta'},{uuid:'second-id',username:'beta'},
    {uuid:'same-id',username:'alpha'},{uuid:'same-id',username:'beta'},{uuid:'second-id',username:'beta'}];
  assert.deepEqual(hostProfiles.collectGalleryUuids(profiles,selected),expected);
  assert.deepEqual(fitnessProfiles.collectGalleryUuids(profiles,selected),expected);
  assert.throws(()=>hostProfiles.collectGalleryUuids(profiles,undefined),TypeError);
  assert.deepEqual(fitnessProfiles.collectGalleryUuids(profiles,undefined),[]);
  const index=buildFingerprintIdentityIndex(profiles);
  assert.deepEqual(index,{'same-id':{userId:'beta',finger:'right'},'second-id':{userId:'beta',finger:null}});
  assert.deepEqual(buildFingerprintIdentityIndex(new Map(Object.entries(profiles))),index);
});
test('CASE-WIRE-FINGERPRINT-WRITE-REFRESH profile writes precede cache refresh and false is not a thrown write failure',async()=>{
  const calls=[];let stored={identities:{admin:true,fingerprints:[{id:'keep'},{id:'remove'},{id:'remove'}]}},mode='normal';
  const writer=createFingerprintProfileWriter({datastore:{readProfile:user=>{calls.push(['read',user]);return stored;},
    writeProfile:(user,next)=>{calls.push(['write',user]);if(mode==='write-throw')throw new Error('synthetic write error');stored=next;return false;}},
    profileCache:{refresh:user=>{calls.push(['refresh',user]);if(mode==='refresh-throw')throw new Error('synthetic refresh error');}}});
  await writer.removeFingerprint('synthetic-user','remove');
  assert.deepEqual(calls,[['read','synthetic-user'],['write','synthetic-user'],['refresh','synthetic-user']]);
  assert.deepEqual(stored.identities,{admin:true,fingerprints:[{id:'keep'}]});
  calls.length=0;mode='write-throw';
  await assert.rejects(writer.addFingerprint('synthetic-user',{id:'not-written'}),/synthetic write error/);
  assert.deepEqual(calls,[['read','synthetic-user'],['write','synthetic-user']]);
  calls.length=0;mode='refresh-throw';
  await assert.rejects(writer.addFingerprint('synthetic-user',{id:'written-before-refresh'}),/synthetic refresh error/);
  assert.equal(stored.identities.fingerprints.at(-1).id,'written-before-refresh');
  assert.equal(calls.at(-1)[0],'refresh');
});

test('CASE-WIRE-PRESSURE-INGEST original adapter normalizes firmware fields and preserves receipt-clock status',()=>{
  const broadcasts=[];let now=Date.parse('2026-09-05T12:00:00.000Z');
  const adapter=new PressureMatAdapter({eventBus:{onClientMessage(){},broadcast:(topic,payload)=>broadcasts.push({topic,payload})},
    config:{pressure_mats:{'audit-mat':{topic:'audit-presence'}}},now:()=>now,logger,
    fetchImpl:()=>{throw new Error('Unexpected HTTP');}});
  const wire={source:'pressure-mat-relay',type:'presence',event:'pressed',id:' audit-mat ',protocol_version:2,
    voltage:1.2,rest_voltage:2,delta_v:0.8,gradient_vps:-0.5,occupied:true,occupancy_known:true,detection_state:'pressed',
    rearm_count:2,steps:4,stomps:1,ts:500,firmware_build:'audit-build',boot_count:3};
  assert.equal(adapter.ingest('synthetic-client',{...wire,gradient_vps:'invalid'}),false);
  assert.equal(adapter.ingest('synthetic-client',wire),true);
  assert.equal(broadcasts.length,1);assert.equal(broadcasts[0].topic,'audit-presence');
  const p=broadcasts[0].payload;assert.equal(p.id,'audit-mat');assert.equal(p.protocolVersion,2);
  assert.equal(p.deltaV,0.8);assert.equal(p.gradientVps,-0.5);assert.equal(p.deviceTs,500);
  assert.equal(p.receivedAt,'2026-09-05T12:00:00.000Z');assert.equal(p.firmwareBuild,'audit-build');assert.equal(p.bootCount,3);
  assert.equal(Object.hasOwn(p,'delta_v'),false);assert.equal(Object.hasOwn(adapter.getStatus('audit-mat').latest,'clientId'),false);
  assert.equal(adapter.getStatus('audit-mat').online,true);now+=90000;assert.equal(adapter.getStatus('audit-mat').online,false);
  assert.equal(adapter.ingest('synthetic-client',{...wire,id:'unconfigured-mat'}),true);
  assert.equal(adapter.getStatus('unconfigured-mat').configured,false);assert.equal(broadcasts[1].topic,'pressure-mat');
});
test('CASE-WIRE-PRESSURE-COMMAND positive thresholds and delivery count are not firmware application acknowledgement',async()=>{
  let delivered=0;const calls=[];
  const adapter=new PressureMatAdapter({eventBus:{onClientMessage(){},broadcast:(topic,payload)=>{calls.push({topic,payload});return delivered;}},
    config:{pressure_mats:{'audit-mat':{}}},logger,fetchImpl:()=>{throw new Error('Unexpected HTTP');}});
  await assert.rejects(adapter.recalibrate('audit-mat'),error=>error.code==='DEVICE_OFFLINE');
  await assert.rejects(adapter.reboot('absent'),error=>error.code==='NOT_FOUND');
  delivered=1;
  const result=await adapter.setThreshold('audit-mat',{delta:3,gradient:6,stompDelta:4,stompGradient:9});
  assert.deepEqual(result,{ok:true,delivered:1,id:'audit-mat',action:'threshold'});
  assert.deepEqual(calls.at(-1),{topic:'pressure-mat-control:audit-mat',payload:{source:'pressure-mat-api',id:'audit-mat',action:'threshold',delta:3,gradient:6,stompDelta:4,stompGradient:9}});
  await assert.rejects(adapter.setThreshold('audit-mat',{delta:0,gradient:1}),error=>error.code==='INVALID_THRESHOLD');
});

test('CASE-PROVIDER-DUPLICATE indexing overwrites duplicate capability/provider without constructing adapters', {timeout: 5000}, async () => {
  let constructed = 0;
  const manifests = Object.fromEntries(['first', 'second'].map(name => [name,
    {capability: 'media', provider: 'files', name, adapter: () => { constructed++; }}]));
  for (const order of [['first', 'second'], ['second', 'first']]) {
    const registry = new AdapterRegistry({adaptersRoot: 'synthetic-root', moduleDiscovery: {
      find: async root => { assert.equal(root, 'synthetic-root'); return order; },
      load: async name => ({default: manifests[name]})
    }});
    await registry.discover();
    assert.equal(registry.getManifest('media', 'files').name, order.at(-1));
    assert.deepEqual(registry.getProviders('media'), ['files']);
  }
  assert.equal(constructed, 0);
});
test('CASE-PROVIDER-LOAD config precedence and repeat loading retain distinct instances without disposal', {timeout: 5000}, async () => {
  const instances = []; let disposed = 0, imports = 0;
  class SyntheticAdapter {
    constructor(config, deps) { this.config = config; this.deps = deps; instances.push(this); }
    isConfigured() { return true; }
    dispose() { disposed++; }
  }
  const loader = new IntegrationLoader({logger, registry: {getManifest: (capability, provider) => {
    assert.equal(capability, 'ai'); assert.equal(provider, 'openai');
    return {adapter: async () => { imports++; return {default: SyntheticAdapter}; }};
  }}, configService: {
    getIntegrationsConfig: household => { assert.equal(household, 'audit-household'); return {openai: {api_key: 'synthetic-service', host: 'synthetic-service-host'}}; },
    getHouseholdAuth: () => ({api_key: 'synthetic-household'}),
    getSystemAuth: () => 'synthetic-system',
    getSecret: key => key === 'OPENAI_API_KEY' ? 'synthetic-secret' : null,
    resolveServiceUrl: () => 'https://provider.invalid'
  }});
  assert.equal(imports, 0);
  const first = await loader.loadForHousehold('audit-household', {logger});
  const second = await loader.loadForHousehold('audit-household', {logger});
  assert.equal(imports, 2); assert.equal(instances.length, 2);
  assert.equal(first.get('ai'), instances[0]); assert.equal(second.get('ai'), instances[1]);
  assert.equal(loader.getAdapters('audit-household'), second); assert.equal(disposed, 0);
  assert.deepEqual(instances[1].config, {api_key: 'synthetic-household', apiKey: 'synthetic-secret', host: 'https://provider.invalid'});
  assert.equal(second.has('ai'), true);
});

check('OMITTED-KEYS route-map entries are not mounted when composition supplies no router', async () => {
  const app = application();
  app.use('/api/v1', createApiRouter({safeConfig: {}, routers: {}, logger}));
  for (const key of ['messaging', 'tts', 'queries'])
    assert.equal((await wireRequest(app, 'GET', '/api/v1/' + key)).status, 404);
  const status = (await wireRequest(app, 'GET', '/api/v1/status')).json();
  assert.deepEqual(status.routes, []);
});
check('SUPPLIED-KEYS existing route-map keys still accept explicitly supplied routers', async () => {
  const app = application(), routers = {};
  for (const key of ['messaging', 'tts', 'queries']) {
    routers[key] = express.Router();
    routers[key].get('/', (_req, res) => res.json({key}));
  }
  app.use('/api/v1', createApiRouter({safeConfig: {}, routers, logger}));
  for (const key of Object.keys(routers))
    assert.deepEqual((await wireRequest(app, 'GET', '/api/v1/' + key)).json(), {key});
});
check('PROXY-REQUIRED prefix middleware handles non-GET methods and reports absent services', async () => {
  const app = application(); app.use('/api/v1/proxy', createProxyRouter({}));
  for (const prefix of ['plex', 'immich', 'abs']) {
    const r = await wireRequest(app, 'PATCH', '/api/v1/proxy/' + prefix + '/synthetic');
    assert.equal(r.status, 503); assert.match(r.json().error, /not configured/);
  }
});
check('PROXY-PLACEHOLDER absent optional passthroughs return cacheable SVG, not 404', async () => {
  const app = application(); app.use('/api/v1/proxy', createProxyRouter({}));
  for (const prefix of ['reddit', 'komga']) {
    const r = await wireRequest(app, 'GET', '/api/v1/proxy/' + prefix + '/synthetic');
    assert.equal(r.status, 200); assert.match(r.body, /<svg/);
    assert.match(r.headers['content-type'], /image\/svg\+xml/);
    assert.equal(String(r.headers['x-proxy-fallback']), 'true');
    assert.equal(r.headers['cache-control'], 'public, max-age=300');
  }
});
check('PROXY-REWRITE Plex thumbnail rewrite precedes the injected passthrough', async () => {
  const app = application(), seen = [];
  app.use('/api/v1/proxy', createProxyRouter({passthroughHandlers: {
    plex: (req, res) => { seen.push({url: req.url, method: req.method}); res.json({ok: true}); }
  }}));
  const r = await wireRequest(app, 'PATCH', '/api/v1/proxy/plex/library/thumb?w=80&h=40');
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [{url: '/photo/:/transcode?width=80&height=40&upscale=1&url=%2Flibrary%2Fthumb', method: 'PATCH'}]);
});

function agents(wireFormat = 'native', extra = {}) {
  const app = application(), calls = [];
  const orchestrator = {
    run: async (...args) => { calls.push(['run', ...args]); return {output: 'synthetic answer'}; },
    runInBackground: async (...args) => { calls.push(['background', ...args]); return {taskId: 'task-a'}; },
    async *streamExecute(...args) { calls.push(['stream', ...args]); yield {type: 'text-delta', text: 'hello'}; }
  };
  mountAgentHttp(app, {orchestrator, agentId: 'synthetic-agent',
    mountPath: wireFormat === 'native' ? '/api/v1/agents' : '/v1', wireFormat, logger, ...extra});
  return {app, calls};
}
check('NATIVE-SYNC dynamic agent path retains parsing and injected-context precedence', async () => {
  const f = agents('native', {contextExtractor: () => ({household: 'injected'})});
  const r = await wireRequest(f.app, 'POST', '/api/v1/agents/synthetic-agent/run', {body: {
    input: 'question', context: {household: 'body', threadId: 'nested'}, threadId: 'root',
    messages: [{role: 'tool', content: 'discard'}, {role: 'user', content: [{type: 'text', text: 'hello'}]}]
  }});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), {agentId: 'synthetic-agent', output: 'synthetic answer', toolCalls: []});
  assert.deepEqual(f.calls, [['run', 'synthetic-agent', 'question', {
    household: 'injected', threadId: 'root', messages: [{role: 'user', content: 'hello'}]
  }]]);
});
check('NATIVE-BACKGROUND missing input rejects before orchestration and valid input returns 202', async () => {
  const f = agents();
  assert.equal((await wireRequest(f.app, 'POST', '/api/v1/agents/synthetic-agent/run', {body: {}})).status, 400);
  assert.deepEqual(f.calls, []);
  const r = await wireRequest(f.app, 'POST', '/api/v1/agents/synthetic-agent/run-background', {body: {input: 'question'}});
  assert.equal(r.status, 202);
  assert.deepEqual(r.json(), {agentId: 'synthetic-agent', taskId: 'task-a', status: 'accepted'});
  assert.equal(f.calls[0][0], 'background');
});
check('NATIVE-STREAM real response serializes SSE chunks and terminal done event', async () => {
  const f = agents();
  const r = await wireRequest(f.app, 'POST', '/api/v1/agents/synthetic-agent/run-stream', {body: {input: 'question'}});
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /^text\/event-stream/);
  assert.equal(r.headers['x-accel-buffering'], 'no');
  assert.equal(r.body, 'data: {"type":"text-delta","text":"hello"}\n\ndata: {"type":"done"}\n\n');
  assert.equal(f.calls.length, 1);
});
check('CONCIERGE-AUTH supplied auth precedes models and chat without invoking orchestration', async () => {
  let denied = 0;
  const f = agents('openai-chat-completions', {authMiddleware: [(_req, res) => {
    denied++; res.status(401).json({error: 'synthetic denial'});
  }]});
  for (const [method, route] of [['GET', '/models'], ['POST', '/chat/completions']])
    assert.equal((await wireRequest(f.app, method, '/v1' + route, {body: {messages: []}})).status, 401);
  assert.equal(denied, 2); assert.deepEqual(f.calls, []);
});
check('CONCIERGE-WIRE advertised models and chat validation retain their separate wire format', async () => {
  const f = agents('openai-chat-completions', {advertisedModels: ['synthetic-model']});
  const models = await wireRequest(f.app, 'GET', '/v1/models');
  assert.deepEqual(models.json().data.map(m => m.id), ['synthetic-model']);
  const head = await wireRequest(f.app, 'HEAD', '/v1/models');
  assert.equal(head.status, 200); assert.equal(head.body, '');
  assert.equal((await wireRequest(f.app, 'POST', '/v1/chat/completions', {body: {messages: []}})).status, 400);
  assert.deepEqual(f.calls, []);
  const chat = await wireRequest(f.app, 'POST', '/v1/chat/completions', {body: {
    model: 'synthetic-model', messages: [{role: 'user', content: 'question'}]
  }});
  assert.equal(chat.status, 200); assert.equal(chat.json().object, 'chat.completion');
  assert.equal(chat.json().choices[0].message.content, 'synthetic answer');
  assert.equal(chat.json().model, 'synthetic-model'); assert.equal(f.calls.length, 1);
});
check('LEGACY-ADMIN current eventBus argument does not supply eventBusAdministration', async () => {
  const app = application(); let effects = 0;
  app.use('/admin/ws', createEventBusRouter({eventBus: {
    available: true, restart: () => effects++, broadcastAdmin: () => effects++, status: () => effects++
  }, logger}));
  for (const [method, route] of [['GET', '/status'], ['POST', '/restart'], ['PATCH', '/broadcast']])
    assert.equal((await wireRequest(app, method, '/admin/ws' + route)).status, 503);
  assert.equal(effects, 0);
});
check('ADMIN-METHODS HEAD restart and ALL broadcast preserve effects while empty GET root falls through', async () => {
  const app = application(), effects = [];
  app.use('/admin/ws', createEventBusRouter({eventBusAdministration: {
    available: true, restart: async () => effects.push('restart'), broadcastAdmin: m => effects.push(m),
    status: () => ({running: true, metrics: {}})
  }, logger}));
  const head = await wireRequest(app, 'HEAD', '/admin/ws/restart');
  assert.equal(head.status, 200); assert.equal(head.body, '');
  assert.equal((await wireRequest(app, 'DELETE', '/admin/ws/broadcast', {body: {synthetic: true}})).status, 200);
  assert.equal((await wireRequest(app, 'GET', '/admin/ws')).status, 404);
  assert.equal(effects.length, 2); assert.equal(effects[0], 'restart'); assert.equal(effects[1].synthetic, true);
});
