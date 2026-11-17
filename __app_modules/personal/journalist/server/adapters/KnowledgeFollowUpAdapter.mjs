import {IKnowledgeCompanion} from '../application/ports/IKnowledgeCompanion.mjs';
/** Presentation/transport adapter. No cross-owner internal imports or identity fallbacks. */
export class KnowledgeFollowUpAdapter extends IKnowledgeCompanion {
 #runtime;#state;#send;#clock;
 constructor({runtime,conversationStateStore,send,clock}){
  super();this.#runtime=runtime;this.#state=conversationStateStore;this.#send=send;this.#clock=clock;
 }
 capturePrincipal(input){return this.#runtime.companion.capturePrincipal(input);}
 sourceForEntry({principal,chatId,messageId,senderId}){
  const p=this.#runtime.companion.verifyPrincipal(principal);
  if(!p||!p.authored||!['text','voice'].includes(p.kind)||p.conversationId!==chatId||p.messageId!==String(messageId)||p.senderId!==String(senderId))return null;
  return {platform:'telegram',conversationId:chatId,messageId:p.messageId,senderId:p.senderId,replyToMessageId:p.replyToMessageId,verified:true};
 }
 selectForMorning(input){return this.#runtime.followUps.selectForMorning(input);}
 prepareDelivery(input){return this.#runtime.followUps.prepareDelivery(input);}
 recordDelivery(input){return this.#runtime.followUps.recordDelivery(input);}
 recordDeliveryFailure(input){return this.#runtime.followUps.recordDeliveryFailure(input);}
 onEntrySaved(input){return this.#runtime.companion.onEntrySaved(input);}
 async #deliver(principal,delivery,responseContext){
  if(!delivery?.sendAllowed)return delivery;
  try{
   const text=delivery.questions.map(q=>q.text).join('\n\n');
   const receipt=responseContext?await responseContext.sendMessage(text,{choices:delivery.choices,inline:true}):await this.#send({username:principal.username,text,choices:delivery.choices,parseMode:null});
   if(!receipt?.messageId)throw Error('Knowledge message not acknowledged');
   await this.recordDelivery({username:principal.username,deliveryId:delivery.deliveryId,botMessageId:receipt.messageId,asOf:this.#clock()});
   return {status:'sent',messageId:receipt.messageId};
  }catch(error){
   try{await this.recordDeliveryFailure({username:principal.username,deliveryId:delivery.deliveryId,uncertain:true,asOf:this.#clock()});}catch{/* Durable pending state still suppresses another send. */}
   throw error;
  }
 }
 async nextQuiz({principal,responseContext}){
  return this.#deliver(principal,await this.#runtime.companion.nextQuiz({principal,asOf:this.#clock()}),responseContext);
 }
 done({principal}){return this.#runtime.companion.done({principal,asOf:this.#clock()});}
 async handleCallback({principal,callbackData,conversationId,responseContext}){
  const isToken=callbackData?.startsWith('kb1:'),isAsk=callbackData==='debrief:ask',isControl=['journal:change','journal:skip','journal:done'].includes(callbackData);
  if(!isToken&&!isAsk&&!isControl)return {handled:false};
  const state=isAsk?await this.#state?.get(conversationId):null;
  if(isAsk&&state?.debrief?.knowledgeSelection?.mode!=='knowledge')return {handled:false};
  const p=this.#runtime.companion.verifyPrincipal(principal);
  if(!p||p.kind!=='callback'||!p.authored||p.conversationId!==conversationId)return {handled:true,status:'rejected'};
  if(isAsk)return {handled:true,...await this.nextQuiz({principal:p,responseContext})};
  if(isControl&&!await this.#runtime.companion.hasActiveQuiz({principal:p}))return {handled:false};
  const result=await this.#runtime.companion.handleCallback({principal:p,callbackData,asOf:this.#clock()});
  if(result.channel==='quiz'&&result.status==='applied'&&result.action!=='done')await this.nextQuiz({principal:p,responseContext});
  return {handled:true,...result};
 }
}
