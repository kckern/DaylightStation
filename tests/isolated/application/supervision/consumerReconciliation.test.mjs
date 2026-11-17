import {describe,it,expect,vi} from 'vitest';
import {HaStopActuator} from '../../../../__app_modules/household/supervision/server/adapters/HaStopActuator.mjs';
import {SupervisionAccessGuard} from '../../../../__app_modules/household/supervision/server/application/SupervisionAccessGuard.mjs';
import {StopReconciler} from '../../../../__app_modules/household/supervision/server/application/StopReconciler.mjs';
import {PortalKeysLockdownAdapter} from '../../../../__backend/src/1_adapters/devices/PortalKeysLockdownAdapter.mjs';
import {KioskArcadeGameTerminator} from '../../../../__app_modules/games/arcade/server/adapters/devices/KioskArcadeGameTerminator.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
async function stopped(){const h=await supervisionFixture();await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});return h;}
describe('independent native stop reconciliation',()=>{
 it('native_session_ends_even_when_the_browser_is_not_foreground',async()=>{
  const h=await stopped();let playing=true;
  const adb={shell:async command=>{if(command.startsWith('pm path '))return {ok:true,output:'package:/data/app/native.apk'};if(command.startsWith('am force-stop ')){playing=false;return {ok:true};}return {ok:true,output:playing?'running':'stopped'};}};
  const terminator=new KioskArcadeGameTerminator({packageName:'org.retroarch',adbByDevice:new Map([['garage',adb]]),logger:{warn(){}}});
  const consumer={deviceId:'garage',capability:'native',stop:input=>terminator.stop(input),release:async()=>({blocked:false})};
  const reconciler=new StopReconciler({...h,consumers:[consumer]});
  const result=await reconciler.reconcile({reason:'parent'});expect(playing).toBe(false);expect(result[0]).toMatchObject({deviceId:'garage',epoch:1,blocked:true,acknowledged:true});
 });
 it('resolved_skipped_is_not_acknowledged_and_has_no_false_last_contact',async()=>{
  const h=await stopped();const reconciler=new StopReconciler({...h,consumers:[{deviceId:'portal',capability:'portal-keys',stop:async()=>({ok:false,skipped:true})}]});
  expect((await reconciler.reconcile())[0]).toMatchObject({blocked:false,acknowledged:false,lastContactAt:null,error:'CAPABILITY_UNAVAILABLE'});
  expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
 });
 it('offline_consumer_retries_same_epoch_on_return',async()=>{
  const h=await stopped();let online=false,accepted=null;
  const consumer={deviceId:'portal',capability:'portal-keys',stop:async command=>{if(!online)throw Error('offline');accepted=command;return {blocked:true};}};
  const reconciler=new StopReconciler({...h,consumers:[consumer]});expect((await reconciler.reconcile())[0].acknowledged).toBe(false);
  online=true;expect((await reconciler.reconcile())[0]).toMatchObject({blocked:true,epoch:1,acknowledged:true,lastContactAt:100000});expect(accepted).toMatchObject({epoch:1,commandRevision:2});
 });
 it('a late release acknowledgement cannot overwrite a newer stop',async()=>{
  const h=await stopped();await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});
  let finish,announce;const started=new Promise(resolve=>{announce=resolve;});
  const consumer={deviceId:'portal',capability:'portal-keys',release:()=>{announce();return new Promise(resolve=>{finish=resolve;});},stop:async()=>({blocked:true})};
  const reconciler=new StopReconciler({...h,consumers:[consumer]});const old=reconciler.reconcile();await started;
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'new-stop'});const latest=await reconciler.reconcile();expect(latest[0]).toMatchObject({blocked:true,acknowledged:true,commandRevision:4});
  finish({blocked:false});await old;expect(reconciler.health()[0]).toMatchObject({blocked:true,acknowledged:true,commandRevision:4});
 });
 it('Portal acknowledgement requires actual durable revision and key suppression state',async()=>{
  let body;
  const portal=new PortalKeysLockdownAdapter({baseUrl:'http://portal:8771',token:'secret',fetchFn:async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({lockdownActive:true,lockdownRevision:2,lockdownProtocolVersion:2})};},logger:{info(){}}});
  expect(await portal.stop({deviceId:'portal',epoch:1,commandRevision:2})).toMatchObject({blocked:true});expect(body).toMatchObject({locked:true,lockedUntil:null,revision:2});
  const old=new PortalKeysLockdownAdapter({baseUrl:'http://portal:8771',token:'secret',fetchFn:async()=>({ok:true,json:async()=>({lockdownActive:false})}),logger:{info(){}}});
  await expect(old.stop({epoch:1,commandRevision:2})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH'});
 });
 it('does not claim native termination when the process is still running',async()=>{
  const native=new KioskArcadeGameTerminator({packageName:'org.retroarch',adbByDevice:new Map([['garage',{shell:async command=>({ok:true,output:command.startsWith('pm path ')?'package:/data/app/native.apk':command.startsWith('am ')?'':'running'})}]]),logger:{warn(){}}});
  expect(await native.stop({deviceId:'garage',epoch:1,commandRevision:2})).toMatchObject({blocked:false});
 });
});
it('native release waits for every earlier kill, including overlapping old revisions',async()=>{
 const pending=[];
 const native=new KioskArcadeGameTerminator({packageName:'org.retroarch',adbByDevice:new Map([['garage',{shell:command=>command.startsWith('am ')?new Promise(resolve=>pending.push(resolve)):Promise.resolve({ok:true,output:command.startsWith('pm path ')?'package:/data/app/native.apk':'stopped'})}]]),logger:{warn(){}}});
 const first=native.stop({deviceId:'garage',commandRevision:2}),second=native.stop({deviceId:'garage',commandRevision:4});let released=false;
 const release=native.release({deviceId:'garage',commandRevision:5}).then(()=>{released=true;});await new Promise(resolve=>setTimeout(resolve,0));pending[1]({ok:true});await second;await Promise.resolve();expect(released).toBe(false);
 pending[0]({ok:true});await first;await release;expect(released).toBe(true);
});

it('unverified required enforcement cannot grant an otherwise normal-mode permit',async()=>{
 const h=await supervisionFixture();let ready=false;
 const consumer={deviceId:'portal',capability:'portal-keys',release:async()=>ready?{blocked:false}:{ok:false,skipped:true}};
 const reconciler=new StopReconciler({...h,consumers:[consumer]});const guard=new SupervisionAccessGuard({...h,enforcementReady:context=>reconciler.isReady(context)});
 await reconciler.reconcile();await expect(guard.authorize({deviceId:'portal',activityId:'school:workspace'})).rejects.toMatchObject({status:403});
 ready=true;await reconciler.reconcile();expect(await guard.authorize({deviceId:'portal',activityId:'school:workspace'})).toMatchObject({expiresAt:105000});
});

it('reconciles immediately after durable intent and on boot, with bounded scheduled retry',async()=>{
 const {createSupervisionModule}=await import('../../../../__app_modules/household/supervision/server/composition.mjs');
 const h=await supervisionFixture();const commands=[];let tick,interval,cancelled=false;
 const consumer={deviceId:'portal',capability:'portal-keys',stop:async command=>{commands.push(['stop',command.commandRevision]);return {blocked:true};},release:async command=>{commands.push(['release',command.commandRevision]);return {blocked:false};}};
 const module=await createSupervisionModule({...h,scopes:{'child-public':['portal']},consumers:[consumer],scheduleEvery:(ms,callback)=>{interval=ms;tick=callback;return ()=>{cancelled=true;};},authenticatedParent:async()=>parent,resolveAccessContext:async()=>({deviceId:'portal',activityId:'school:workspace'})});
 await new Promise(resolve=>setTimeout(resolve,0));expect(commands).toContainEqual(['release',1]);expect(interval).toBeLessThanOrEqual(5000);
 await module.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'immediate'});
 await new Promise(resolve=>setTimeout(resolve,0));expect(commands).toContainEqual(['stop',2]);
 commands.length=0;await tick();await new Promise(resolve=>setTimeout(resolve,0));expect(commands).toContainEqual(['stop',2]);
 module.dispose();expect(cancelled).toBe(true);
});
it('an old enforcement acknowledgement cannot issue an access lease after contact is lost',async()=>{
 const h=await supervisionFixture();const reconciler=new StopReconciler({...h,consumers:[{deviceId:'portal',capability:'portal-keys',release:async()=>({blocked:false})}]});
 await reconciler.reconcile();expect(await reconciler.isReady({deviceId:'portal'})).toBe(true);h.setNow(105001);expect(await reconciler.isReady({deviceId:'portal'})).toBe(false);
});
it('normal-mode native readiness requires a reachable installed package, not an empty release ACK',async()=>{
 const offline=new KioskArcadeGameTerminator({packageName:'org.retroarch',adbByDevice:new Map(),logger:{warn(){}}});
 await expect(offline.release({deviceId:'garage'})).rejects.toThrow();
 const missing=new KioskArcadeGameTerminator({packageName:'org.retroarch',adbByDevice:new Map([['garage',{shell:async()=>({ok:true,output:''})}]]),logger:{warn(){}}});
 await expect(missing.release({deviceId:'garage'})).rejects.toThrow();
});

it('rejects obsolete revision acknowledgements',async()=>{
 const h=await stopped();const reconciler=new StopReconciler({...h,consumers:[{deviceId:'portal',capability:'portal-keys',stop:async()=>({blocked:true,commandRevision:1})}]});
 await reconciler.reconcile();expect(await reconciler.isReady({deviceId:'portal'})).toBe(false);
});
it('observes pending commands while a consumer is still awaiting a response',async()=>{
 const h=await stopped();const observations=[];let finish;
 const reconciler=new StopReconciler({...h,incidentReporter:{observe:async value=>observations.push(value)},consumers:[{deviceId:'portal',capability:'portal-keys',stop:()=>new Promise(resolve=>{finish=resolve;})}]});
 const pending=reconciler.reconcile();await new Promise(resolve=>setTimeout(resolve,0));
 expect(reconciler.health()[0]).toMatchObject({deviceId:'portal',acknowledged:false,desiredBlocked:true,commandRevision:2});
 expect(observations.length).toBeGreaterThan(0);finish({blocked:true});await pending;
});
it('incident persistence failure cannot withhold a native Stop',async()=>{
 const h=await stopped();let stops=0;
 const reconciler=new StopReconciler({...h,logger:{warn(){}},incidentReporter:{observe:async()=>{throw Error('disk failure');}},consumers:[{deviceId:'portal',capability:'portal-keys',stop:async()=>{stops++;return {blocked:true};}}]});
 await expect(reconciler.reconcile()).resolves.toBeTruthy();expect(stops).toBe(1);expect(reconciler.health()[0]).toMatchObject({commandRevision:2,desiredBlocked:true,acknowledged:true,incidentReportingError:'INCIDENT_REPORTING_UNAVAILABLE'});
});
it('records the first pending command before a hung consumer can finish',async()=>{
 const h=await stopped();const observations=[];let finish;
 const reconciler=new StopReconciler({...h,incidentReporter:{observe:async value=>observations.push(value)},consumers:[{deviceId:'portal',capability:'portal-keys',stop:()=>new Promise(resolve=>{finish=resolve;})}]});
 const pending=reconciler.reconcile();await new Promise(resolve=>setTimeout(resolve,0));
 expect(observations.some(value=>value.health.some(row=>row.commandRevision===2 && row.desiredBlocked && !row.acknowledged))).toBe(true);
 finish({blocked:true});await pending;
});

it('release does not restart content',async()=>{
 const h=await stopped(),contentLaunch=vi.fn(),powerOn=vi.fn();let latch='on',revision=2;
 const gateway={callService:async(_domain,service,data)=>{
  if(service==='daylight_parental_stop'){latch=data.active?'on':'off';revision=data.command_revision;}
  else if(service.includes('play') || service.includes('load'))contentLaunch();
  else powerOn();return {ok:true};
 },getState:async id=>({state:id==='input_boolean.daylight_parental_stop'?latch:`${revision}:${latch}`})};
 const actuator=new HaStopActuator({gateway,clock:h.clock,sleep:async()=>{},entities:['switch.fixture']});
 const reconciler=new StopReconciler({...h,consumers:[{deviceId:'garage',capability:'ha-stop',release:command=>actuator.release(command)}]});
 await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release-no-resume'});await reconciler.reconcile();
 expect(await h.service.status({deviceId:'garage'})).toMatchObject({active:false});
 expect(await reconciler.isReady({deviceId:'garage'})).toBe(true);expect(latch).toBe('off');
 expect(contentLaunch).not.toHaveBeenCalled();expect(powerOn).not.toHaveBeenCalled();
});
it('offline consumer prevents an all-enforced result',async()=>{
 const h=await supervisionFixture();
 // The durable scope and registered consumer cover the piano as well as the online Portal.
 const {SupervisionService}=await import('../../../../__app_modules/household/supervision/server/application/SupervisionService.mjs');
 const service=new SupervisionService({...h,scopes:{'child-public':['portal','yellow-room-tablet']}});await service.initialize();
 await service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'partial-offline'});
 const reconciler=new StopReconciler({...h,consumers:[{deviceId:'portal',capability:'portal-keys',stop:async()=>({blocked:true})},{deviceId:'yellow-room-tablet',capability:'browser',stop:async()=>{throw Error('offline');}}]});
 await reconciler.reconcile();expect(await reconciler.isReady({deviceId:'portal'})).toBe(true);
 expect(await reconciler.isReady({deviceId:'yellow-room-tablet'})).toBe(false);
 expect((await Promise.all(['portal','yellow-room-tablet'].map(deviceId=>reconciler.isReady({deviceId})))).every(Boolean)).toBe(false);
 expect(await service.status({deviceId:'yellow-room-tablet'})).toMatchObject({active:true});
});
