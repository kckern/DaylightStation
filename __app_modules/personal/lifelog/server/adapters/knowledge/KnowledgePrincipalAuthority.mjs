import { timingSafeEqual } from 'node:crypto';
const ID=/^[1-9][0-9]*$/;
/** Request-local capability. Serialized flags or a conversation string cannot forge it. */
export function createKnowledgePrincipalAuthority({identityForSender,webhookSecret,clock}) {
  if(typeof identityForSender!=='function'||typeof clock!=='function')throw new TypeError('Invalid principal authority dependencies');
  const trusted=new WeakSet();
  const configured=typeof webhookSecret==='string'&&webhookSecret.trim()?Buffer.from(webhookSecret,'utf8'):null;
  function current(principal) {
    const identity=identityForSender(principal.senderId);
    return identity&&identity.username===principal.username&&String(identity.senderId)===principal.senderId&&identity.conversationId===principal.conversationId;
  }
  return Object.freeze({
    attest({event,webhookSecret:presented,forwarded=false}) {
      if(!configured||typeof presented!=='string')return null;
      const supplied=Buffer.from(presented,'utf8');
      if(supplied.length!==configured.length||!timingSafeEqual(supplied,configured))return null;
      if(event?.platform!=='telegram'||!['text','voice','command','callback'].includes(event.type))return null;
      const senderId=event.metadata?.senderId,chatId=event.metadata?.chatId;
      if(typeof senderId!=='string'||!ID.test(senderId)||event.platformUserId!==senderId||chatId!==senderId||event.metadata.chatType!=='private'||!ID.test(event.messageId??''))return null;
      const identity=identityForSender(senderId),at=clock();
      if(!identity||typeof identity.username!=='string'||String(identity.senderId)!==senderId||identity.conversationId!==event.conversationId||!Number.isFinite(at))return null;
      const callbackId=event.payload?.callbackId;
      if(event.type==='callback'&&(typeof callbackId!=='string'||!callbackId||callbackId.length>128||typeof event.payload?.callbackData!=='string'||Buffer.byteLength(event.payload.callbackData,'utf8')>64))return null;
      const principal=Object.freeze({platform:'telegram',kind:event.type,username:identity.username,senderId,conversationId:identity.conversationId,
        messageId:String(event.messageId),receiptId:event.type==='callback'?`${identity.conversationId}:callback:${callbackId}`:`${identity.conversationId}:message:${event.messageId}`,
        callbackData:event.type==='callback'?event.payload.callbackData:null,
        replyToMessageId:ID.test(event.metadata.replyToMessageId??'')?String(event.metadata.replyToMessageId):null,
        authored:!forwarded,receivedAt:at});
      trusted.add(principal);return principal;
    },
    verify(principal){
      if(!principal||!trusted.has(principal)||!Object.isFrozen(principal))return null;
      try{return current(principal)?principal:null;}catch{return null;}
    },
  });
}
