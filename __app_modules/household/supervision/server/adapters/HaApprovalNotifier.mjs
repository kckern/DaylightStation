import {formatClockTime,formatDuration,pushData} from '#domains/notification/push/pushText.mjs';
/** Reuses HA transport; opaque actions never become a child response or log field. */
export class HaApprovalNotifier {
  #call;#service;#recipient;#clock;#learner;#device;#timezone;#logger;
  constructor({callHomeAssistant,notifyService,recipientId,clock,learnerName,deviceName,timezone,logger}){
    if(!callHomeAssistant?.execute || !/^notify\.[a-zA-Z0-9_]+$/.test(notifyService??'') || !recipientId || !clock?.now)throw new TypeError('Authenticated parent notification configuration required');
    this.#call=callHomeAssistant;this.#service=notifyService.slice(7);this.#recipient=recipientId;this.#clock=clock;this.#learner=learnerName;this.#device=deviceName;this.#timezone=timezone;this.#logger=logger;
  }
  async notify({request,recipient,actions}){
    if(recipient!==this.#recipient)throw new TypeError('Notification recipient mismatch');
    const remaining=request.expiresAt-this.#clock.now();if(remaining<=0)return {accepted:false};
    const learner=this.#learner?.(request.learnerId)||'Your child',device=this.#device?.(request.deviceId)||'this screen',activity=request.label||'the selected activity';
    const deadline=formatClockTime(new Date(request.expiresAt).toISOString(),this.#timezone);
    const result=await this.#call.execute({domain:'notify',service:this.#service,sensitive:true,data:{
      title:'Permission requested',message:`${learner} requested ${activity} on ${device}. Allow up to ${formatDuration(600000)}?${deadline?` Reply by ${deadline}.`:''}`,
      data:pushData({tag:`supervision-${request.id}`,channel:'Parental permissions',importance:'high',alertOnce:true,ttl:0,priority:'high',timeout:Math.ceil(remaining/1000),actions:[
        {action:`DS_SUPERVISION_APPROVE:${actions.approveNonce}`,title:'Approve',authenticationRequired:true},
        {action:`DS_SUPERVISION_DENY:${actions.denyNonce}`,title:'Deny',authenticationRequired:true},
      ]}),
    }});
    const accepted=result?.result?.ok===true;this.#logger?.info?.('supervision.push.outcome',{requestId:request.id,recipientId:this.#recipient,accepted});return {accepted};
  }
}
