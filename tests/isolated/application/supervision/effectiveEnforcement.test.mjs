import {it,expect} from 'vitest';
import {EffectiveEnforcement} from '../../../../__app_modules/household/supervision/server/application/EffectiveEnforcement.mjs';
import {ApprovalWorkflow} from '../../../../__app_modules/household/supervision/server/application/ApprovalWorkflow.mjs';
import {createApprovalTokenPrimitives} from '../../../../__app_modules/household/supervision/server/adapters/ApprovalTokenPrimitives.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
it('mode, exact consumed grants, expiry and Stop produce ordered commands; heartbeats do not reset sessions',async()=>{
 const h=await supervisionFixture();let id=0;const pushes=[],context={deviceId:'portal',learnerId:'user_5',activityId:'school:workspace',clientSessionId:'browser'};
 const workflow=new ApprovalWorkflow({...h,...createApprovalTokenPrimitives(),makeId:()=>`id-${++id}`,recipientId:'parent',notifier:{notify:async input=>{pushes.push(input);return {accepted:true};}},resolveActivity:async()=>({id:'school:workspace',owner:'school'}),baselineEligibility:async()=>({allowed:true})});
 const controller=new EffectiveEnforcement({...h,workflow,devices:[{id:'portal',requiredCapabilities:['browser','native:pkg']}],nativeActivity:()=>false});
 await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000});await controller.refresh();const normal=await controller.command({deviceId:'portal',capability:'browser'});expect(normal.blocked).toBe(false);
 h.setNow(100001);await h.service.publishMode({required:true,observedAt:100001,expiresAt:160001});await controller.refresh();const blocked=await controller.command({deviceId:'portal',capability:'browser'});expect(blocked.blocked).toBe(true);expect(blocked.commandRevision).toBeGreaterThan(normal.commandRevision);
 const request=await workflow.requestPermission({context,idempotencyKey:'one'});await workflow.decideRequest({requestId:request.id,actor:parent,decision:'approve',nonce:pushes[0].actions.approveNonce});await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).blocked).toBe(true);
 await workflow.consumeGrant({requestId:request.id,context});await controller.refresh();const playing=await controller.command({deviceId:'portal',capability:'browser'});expect(playing.blocked).toBe(false);expect((await controller.command({deviceId:'portal',capability:'native:pkg'})).blocked).toBe(true);
 h.setNow(100002);await h.service.publishMode({required:true,observedAt:100002,expiresAt:160002});await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).commandRevision).toBe(playing.commandRevision);
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).blocked).toBe(true);await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).blocked).toBe(true);
});
it('a stale mode closes normal enforcement on canonical expiry without a websocket event',async()=>{
 const h=await supervisionFixture();const controller=new EffectiveEnforcement({...h,devices:[{id:'portal',requiredCapabilities:['browser']}],workflow:{}});
 await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000});await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).blocked).toBe(false);
 h.setNow(160001);await controller.refresh();expect((await controller.command({deviceId:'portal',capability:'browser'})).blocked).toBe(true);
});
