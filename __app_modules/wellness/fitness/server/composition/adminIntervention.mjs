import {AdminInterventionAuthority} from '../application/AdminInterventionAuthority.mjs';
/** Scanner identity is server-resolved against household owner/guardian profiles. */
export function createAdminInterventionRuntime({service,userService,householdId,deviceId,clock,makeId,scopeId='child-public'}){
  const authority=new AdminInterventionAuthority({clock,makeId,
    resolveActor:async userId=>{
      const profile=userService.getProfile(userId);
      if(!profile || (profile.household_id??householdId)!==householdId)return null;
      return {id:userId,roles:[...(profile.roles??[]),...(profile.type==='owner'?['owner']:[])],authenticatedBy:'fingerprint-relay'};
    },
    onStop:({actor,idempotencyKey})=>service.stop({actor,scopeId,source:'fingerprint',idempotencyKey}),
    onRelease:({actor,idempotencyKey})=>service.release({actor,scopeId,idempotencyKey}),
  });
  return {authority,legacy:{
    status:()=>service.status({deviceId}),
    beginRelease:()=>authority.beginPurpose({deviceId,purpose:'release'}),
    waitForIntervention:()=>authority.waitForIntervention({deviceId}),
  }};
}
