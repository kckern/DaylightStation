import {it,expect,vi} from 'vitest';
import {ProcessTextEntry} from './ProcessTextEntry.mjs';
function setup({suppress=true,failSave=false}={}){
 const order=[],principal=Object.freeze({username:'sample'}),source={platform:'telegram',conversationId:'telegram:b42_c101',messageId:'99',senderId:'101',verified:true,replyToMessageId:'88'};
 const ai={chat:vi.fn(async()=>'{"acknowledgment":"Noted","question":"Did it go well?"}')},saved=[],companion={sourceForEntry:vi.fn(()=>source),onEntrySaved:vi.fn(async({message})=>{order.push('schedule');expect(saved).toContain(message);return {scheduled:true,suppressFollowUp:suppress};})};
 const repo={saveMessage:vi.fn(async message=>{order.push('save');if(failSave)throw Error('write failed');saved.push(message);return message;}),getMessageHistory:async()=>[]};
 const service=new ProcessTextEntry({messagingGateway:{sendMessage:async()=>({messageId:'100'})},aiGateway:ai,journalEntryRepository:repo,knowledgeCompanion:companion,clock:()=>123,logger:{debug(){},info(){},error(){},warn(){}}});
 return {service,ai,repo,companion,order,principal};
}
const run=(d,text='x'.repeat(601))=>d.service.execute({chatId:'telegram:b42_c101',messageId:'99',senderId:'101',senderName:'Sample',text,knowledgePrincipal:d.principal});
it('saves verified provenance before scheduling and suppresses both immediate model calls for a long entry',async()=>{
 const d=setup();expect((await run(d)).knowledgeScheduled).toBe(true);expect(d.order).toEqual(['save','schedule']);expect(d.ai.chat).not.toHaveBeenCalled();expect(d.repo.saveMessage.mock.calls[0][0]).toMatchObject({role:'user',source:{verified:true,messageId:'99',replyToMessageId:'88'}});
});
it('retains ordinary conversational replies when the companion does not suppress them',async()=>{
 const d=setup({suppress:false});await run(d,'x'.repeat(600));expect(d.ai.chat).toHaveBeenCalledTimes(2);
});
it('never schedules an entry whose journal save failed',async()=>{
 const d=setup({failSave:true});await expect(run(d)).rejects.toThrow('write failed');expect(d.companion.onEntrySaved).not.toHaveBeenCalled();expect(d.ai.chat).not.toHaveBeenCalled();
});
