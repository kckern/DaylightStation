import {it,expect,vi} from 'vitest';
import {KnowledgeFollowUpAdapter} from './KnowledgeFollowUpAdapter.mjs';
const principal=Object.freeze({username:'sample',senderId:'101',conversationId:'telegram:b42_c101',messageId:'99',authored:true,kind:'text',replyToMessageId:'88'});
const callbackPrincipal=Object.freeze({...principal,kind:'callback'});
function setup({verified=true,knowledge=true}={}){
 const replies=[],runtime={followUps:{recordDelivery:vi.fn(async()=>{}),recordDeliveryFailure:vi.fn(async()=>{})},companion:{verifyPrincipal:p=>verified&&(p===principal||p===callbackPrincipal)?p:null,handleCallback:vi.fn(async()=>({status:'applied',channel:'morning'})),nextQuiz:vi.fn(async()=>({sendAllowed:true,deliveryId:'delivery-1',questions:[{text:'Did you finish: Sample reply?'}],choices:[[{text:'Yes',callback_data:'kb1:sample:y'}]]}))}};
 const adapter=new KnowledgeFollowUpAdapter({runtime,clock:()=>123,conversationStateStore:{get:async()=>({debrief:knowledge?{knowledgeSelection:{mode:'knowledge'}}:{}})},send:async input=>{replies.push(input);return {messageId:'100'};}});
 return {adapter,runtime,replies};
}
it('creates provenance only from a verified authored matching input principal',()=>{
 const d=setup();expect(d.adapter.sourceForEntry({principal,chatId:principal.conversationId,messageId:'99',senderId:'101'})).toMatchObject({verified:true,replyToMessageId:'88'});
 expect(d.adapter.sourceForEntry({principal,chatId:principal.conversationId,messageId:'100',senderId:'101'})).toBeNull();expect(setup({verified:false}).adapter.sourceForEntry({principal})).toBeNull();
});
it('uses persisted KB day state for Ask, sends the quiz with choices and binds its ACK',async()=>{
 const d=setup();expect((await d.adapter.handleCallback({principal:callbackPrincipal,callbackData:'debrief:ask',conversationId:principal.conversationId})).handled).toBe(true);
 expect(d.replies[0]).toMatchObject({username:'sample',text:'Did you finish: Sample reply?',choices:[[{text:'Yes',callback_data:'kb1:sample:y'}]]});expect(d.runtime.followUps.recordDelivery).toHaveBeenCalledWith({username:'sample',deliveryId:'delivery-1',botMessageId:'100',asOf:123});
});
it('does not hijack legacy Ask and rejects unverified token callbacks without sending',async()=>{
 expect((await setup({knowledge:false}).adapter.handleCallback({principal:callbackPrincipal,callbackData:'debrief:ask',conversationId:principal.conversationId})).handled).toBe(false);
 const d=setup({verified:false});expect(await d.adapter.handleCallback({principal:callbackPrincipal,callbackData:'kb1:sample:y',conversationId:principal.conversationId})).toMatchObject({handled:true,status:'rejected'});expect(d.replies).toEqual([]);
});
