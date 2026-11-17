import { it, expect } from 'vitest';
import { createKnowledgePrincipalAuthority } from './KnowledgePrincipalAuthority.mjs';
const secret='synthetic-webhook-secret';
const event=(extra={})=>({platform:'telegram',platformUserId:'101',conversationId:'telegram:b42_c101',type:'callback',messageId:'99',metadata:{senderId:'101',chatId:'101',chatType:'private'},payload:{callbackId:'callback-1',callbackData:'debrief:ask'},...extra});
const make=()=>createKnowledgePrincipalAuthority({webhookSecret:secret,clock:()=>1000,identityForSender:id=>id==='101'?{username:'sample',senderId:'101',conversationId:'telegram:b42_c101'}:id==='202'?{username:'other',senderId:'202',conversationId:'telegram:b42_c202'}:null});
it('brands a frozen request-local principal and rejects a forged serialized copy',()=>{
 const authority=make(),input=event(),principal=authority.attest({event:input,webhookSecret:secret});
 expect(principal).toMatchObject({username:'sample',senderId:'101',messageId:'99',callbackData:'debrief:ask',receiptId:'telegram:b42_c101:callback:callback-1'});expect(Object.isFrozen(principal)).toBe(true);
 input.metadata.senderId='202';input.payload.callbackData='forged';expect(principal.senderId).toBe('101');expect(principal.callbackData).toBe('debrief:ask');
 expect(authority.verify(principal)).toBe(principal);expect(authority.verify(Object.freeze({...principal}))).toBeNull();
});
it('requires a configured matching webhook secret, exact sender mapping and the configured private chat',()=>{
 const authority=make();
 const candidates=[
  {event:event(),webhookSecret:'wrong'},
  {event:event({metadata:{senderId:'101',chatId:'-999',chatType:'group'}}),webhookSecret:secret},
  {event:event({metadata:{senderId:'999',chatId:'999',chatType:'private'},platformUserId:'999'}),webhookSecret:secret},
  {event:event({conversationId:'telegram:b42_c202'}),webhookSecret:secret},
  {event:event({metadata:{senderId:'101',chatType:'private'}}),webhookSecret:secret},
 ];
 for(const candidate of candidates)expect(authority.attest(candidate)).toBeNull();
 expect(createKnowledgePrincipalAuthority({webhookSecret:null,clock:()=>1000,identityForSender:()=>({username:'sample',senderId:'101',conversationId:'telegram:b42_c101'})}).attest({event:event(),webhookSecret:''})).toBeNull();
});
it('keeps concurrent users separate and marks forwarded text as unauthored evidence',()=>{
 const authority=make(),one=authority.attest({event:event(),webhookSecret:secret});
 const two=authority.attest({event:event({type:'text',messageId:'101',platformUserId:'202',conversationId:'telegram:b42_c202',metadata:{senderId:'202',chatId:'202',chatType:'private'},payload:{text:'forwarded text',replyToMessageId:'22'}}),webhookSecret:secret,forwarded:true});
 expect(authority.verify(one).username).toBe('sample');expect(authority.verify(two)).toMatchObject({username:'other',authored:false});
});
