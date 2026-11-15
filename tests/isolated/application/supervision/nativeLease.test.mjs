import {it,expect} from 'vitest';
import {NativeLeaseAuthority} from '../../../../__app_modules/household/supervision/server/application/NativeLeaseAuthority.mjs';
import {NativeLeaseConsumer} from '../../../../__app_modules/household/supervision/server/adapters/NativeLeaseConsumer.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
it('native renewal uses canonical mode, exact trusted title, epoch and grant bounds; caller title is not proof',async()=>{
 const h=await supervisionFixture();await h.service.publishMode({required:true,observedAt:100000,expiresAt:160000});let proof={state:'running',contentId:'arcade:gb/mario',observedAt:100000},valid=true;
 const request={id:'request',deviceId:'portal',learnerId:'user_5',activityId:'arcade:gb/mario',clientSessionId:'browser',period:{kind:'occurrence',id:'request',startsAt:100000,endsAt:820000},target:{owner:'arcade',nativePackage:'com.retroarch'}};
 const grant={requestId:'request',deviceId:'portal',learnerId:'user_5',activityId:request.activityId,clientSessionId:'browser',epoch:0,expiresAt:700000,sessionId:'session',consumedAt:100000,publication:'acknowledged',revokedAt:null};
 await h.repository.transaction(state=>{state.requests.request=request;state.grants.request=grant;});await h.stateGates.publishGrant({request,valid:true,sourceRevision:1,observedAt:100000,expiresAt:700000});
 const consumer=new NativeLeaseConsumer({deviceId:'portal',packageName:'com.retroarch',clock:h.clock});const authority=new NativeLeaseAuthority({...h,workflow:{contextForPermit:async()=>{if(!valid)throw Error('No grant');return {period:request.period,expiresAt:700000};}},enforcement:{command:async()=>({commandRevision:3,epoch:0,blocked:false})},consumers:[consumer],observeNative:async()=>proof});
 const input={deviceId:'portal',packageName:'com.retroarch',ack:{protocol:1,capabilityReady:true,blocked:true,commandRevision:3,epoch:0}};
 expect(await authority.renew(input)).toMatchObject({allowed:true,leaseMs:5000,commandRevision:3});proof={...proof,contentId:'arcade:gb/other'};expect((await authority.renew({...input,contentId:request.activityId})).allowed).toBe(false);
 proof={state:'idle',observedAt:100000};h.setNow(105001);expect((await authority.renew(input)).allowed).toBe(false);proof={state:'running',contentId:request.activityId,observedAt:100000};expect((await authority.renew(input)).allowed).toBe(false);
 proof.observedAt=105001;valid=false;expect((await authority.renew(input)).allowed).toBe(false);await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});expect((await authority.renew(input)).allowed).toBe(false);
});
it('native capability is unavailable until a fresh authenticated protocol ACK proves local enforcement',async()=>{
 const h=await supervisionFixture(),consumer=new NativeLeaseConsumer({deviceId:'portal',packageName:'com.retroarch',clock:h.clock});expect((await consumer.release({commandRevision:1,epoch:0})).ok).toBe(false);
 consumer.acknowledge({protocol:1,capabilityReady:true,blocked:true,commandRevision:1,epoch:0});expect(await consumer.stop({commandRevision:1,epoch:0})).toMatchObject({blocked:true});h.setNow(105001);expect((await consumer.stop({commandRevision:1,epoch:0})).ok).toBe(false);
});
