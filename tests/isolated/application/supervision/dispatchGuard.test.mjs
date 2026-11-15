import {describe,it,expect} from 'vitest';
import {SupervisionAccessGuard} from '../../../../__app_modules/household/supervision/server/application/SupervisionAccessGuard.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
import {DoNowService} from '../../../../__app_modules/household/donow/server/application/DoNowService.mjs';
import {LaunchService} from '../../../../__capabilities/device-dispatch/server/application/LaunchService.mjs';
import {AuthorizeArcadeGameSession} from '../../../../__app_modules/games/arcade/server/application/usecases/AuthorizeArcadeGameSession.mjs';
const context={deviceId:'portal',learnerId:'user_5',activityId:'arcade:test'};
async function fixture(){const h=await supervisionFixture();return {...h,guard:new SupervisionAccessGuard(h)};}
describe('mandatory supervision dispatch admission',()=>{
 it('accepted_stop_prevents_concurrent_dispatch',async()=>{
  const h=await fixture();let started=0;
  const stop=h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});
  const dispatch=h.guard.runAuthorized(context,()=>{started++;});
  await stop;await expect(dispatch).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});expect(started).toBe(0);
 });
 it('an already admitted slow effect cannot delay accepting parent stop',async()=>{
  const h=await fixture();let announce,finish;const started=new Promise(resolve=>{announce=resolve;});const pending=new Promise(resolve=>{finish=resolve;});
  const dispatched=h.guard.runAuthorized(context,()=>{announce();return pending;});await started;
  const stop=await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});expect(stop.active).toBe(true);finish();await dispatched;
 },1000);
 it('missing context, pending projection and query errors all deny',async()=>{
  const h=await fixture();await expect(h.guard.authorize({})).rejects.toMatchObject({status:403});
  expect(await h.guard.authorize(context)).toMatchObject({epoch:0,expiresAt:105000});
  await h.repository.transaction(state=>{state.devices.portal.publication='pending';});await expect(h.guard.authorize(context)).rejects.toMatchObject({status:403});
  await h.repository.transaction(state=>{state.devices.portal.publication='acknowledged';});
  const failed=new SupervisionAccessGuard({...h,stateGates:{decide:async()=>{throw Error('offline');}}});await expect(failed.authorize(context)).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});
 });
 it('direct launch and resolve-intent never dispatch or expose an intent while stopped',async()=>{
  const h=await fixture();let effects=0;
  const launch=new LaunchService({contentCatalog:{resolve:id=>id,getItem:async()=>({title:'Game',launchIntent:{target:'retroarch',params:{}}})},deviceLauncher:{canLaunch:async()=>true,launch:async()=>{effects++;}},supervision:h.guard,logger:{info(){},debug(){}}});
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
  await expect(launch.launch({contentId:'arcade:test',targetDeviceId:'portal',accessContext:context})).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});
  await expect(launch.resolveIntent('arcade:test',context)).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});expect(effects).toBe(0);
 });
 it('stopped intent resolution cannot run device preparation',async()=>{
  const h=await fixture();let prepared=0;
  const launch=new LaunchService({contentCatalog:{resolve:id=>id,getItem:async()=>({launchIntent:{target:'retroarch'}})},deviceLauncher:{canLaunch:async()=>true,launch:async()=>{}},prepareLaunch:async()=>{prepared++;},supervision:h.guard,logger:{info(){},debug(){}}});
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
  await expect(launch.resolveIntent('arcade:test',context)).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});expect(prepared).toBe(0);
 });
 it('arcade authorization cannot issue an intent through its legacy optional probes',async()=>{
  const h=await fixture();let records=0;
  const authorize=new AuthorizeArcadeGameSession({authorization:{confirmIdentity:async()=>({confirmed:true,userId:'user_5'})},intents:{record:async()=>{records++;}},supervision:h.guard});
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
  await expect(authorize.execute({deviceId:'portal',content:{contentId:'arcade:test'},surface:'browser',accessContext:context})).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});expect(records).toBe(0);
 });
});

it('DoNow approved dispatch still requires the mandatory supervision decision',async()=>{
 const h=await fixture();let dispatched=0;
 const donow=new DoNowService({surfaces:new Map([['portal',{label:()=> 'Portal',dispatch:async()=>{dispatched++;return {dispatched:true};}}]]),datastore:{appendDispatch:async()=>{}},dispatchAuthority:(_record,effect)=>h.guard.runAuthorized({...context,activityId:'school:workspace'},effect),logger:{error(){},warn(){}}});
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
 await expect(donow.dispatchApproved({id:'old-phone-approval',surface:'portal',action:{},learnerId:'user_5'})).rejects.toMatchObject({code:'SUPERVISION_BLOCKED'});expect(dispatched).toBe(0);
});

it('a supervised launch cannot manufacture a trusted context from its target fields',async()=>{
 const h=await fixture();let launched=0;
 const service=new LaunchService({contentCatalog:{resolve:id=>id,getItem:async()=>({launchIntent:{target:'retroarch'}})},deviceLauncher:{canLaunch:async()=>true,launch:async()=>{launched++;}},supervision:h.guard,logger:{info(){},debug(){}}});
 await expect(service.launch({contentId:'arcade:test',targetDeviceId:'portal'})).rejects.toMatchObject({status:403});expect(launched).toBe(0);
});
it('automatic device constraints cannot move a credentialed kiosk onto another target',async()=>{
 const h=await fixture();let launched=0;
 const service=new LaunchService({contentCatalog:{resolve:id=>id,getItem:async()=>({deviceConstraint:'native',launchIntent:{target:'retroarch'}})},findDeviceByConstraint:()=> 'garage',deviceLauncher:{canLaunch:async()=>true,launch:async()=>{launched++;}},supervision:h.guard,logger:{info(){},debug(){}}});
 await expect(service.launch({contentId:'arcade:test',accessContext:context})).rejects.toMatchObject({status:403});expect(launched).toBe(0);
});
