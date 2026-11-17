import {it,expect} from 'vitest';
import {YamlJournalEntryRepository} from '../../../../../__app_modules/personal/journalist/server/adapters/persistence/YamlJournalEntryRepository.mjs';
import {KnowledgeFollowUpAdapter} from '../../../../../__app_modules/personal/journalist/server/adapters/KnowledgeFollowUpAdapter.mjs';
import {ProcessTextEntry} from '../../../../../__app_modules/personal/journalist/server/application/usecases/ProcessTextEntry.mjs';
import {ProcessVoiceEntry} from '../../../../../__app_modules/personal/journalist/server/application/usecases/ProcessVoiceEntry.mjs';
import {JournalistInputRouter} from '../../../../../__app_modules/personal/journalist/server/application/services/JournalistInputRouter.mjs';
import {createKnowledgePrincipalAuthority} from '../../../../../__app_modules/personal/lifelog/server/adapters/knowledge/KnowledgePrincipalAuthority.mjs';
import {JournalKnowledgeEvidence} from '../../../../../__app_modules/personal/lifelog/server/adapters/knowledge/JournalKnowledgeEvidence.mjs';
function setup(){
 let journal={messages:[]},calls=0,models=0;const now=Date.now(),secret='synthetic-secret',identity={username:'sample',senderId:'101',conversationId:'telegram:b42_c101'};
 const authority=createKnowledgePrincipalAuthority({identityForSender:id=>id==='101'?identity:null,webhookSecret:secret,clock:()=>now});
 const repo=new YamlJournalEntryRepository({dataService:{user:{read:()=>structuredClone(journal),write:(_,data)=>{journal=structuredClone(data);return true;}}},userResolver:{resolveUser:()=> 'sample'},logger:{debug(){},error(){}}});
 const companion=new KnowledgeFollowUpAdapter({runtime:{companion:{verifyPrincipal:authority.verify,onEntrySaved:async()=>{calls++;return {scheduled:true,suppressFollowUp:true};}}},clock:()=>now});
 const gateway={sendMessage:async()=>({messageId:'200'}),transcribeVoice:async()=> 'I will contact Sample on Monday. '.padEnd(601,'x')};
 const text=new ProcessTextEntry({knowledgeCompanion:companion,journalEntryRepository:repo,messagingGateway:gateway,aiGateway:{chat:async()=>{models++;return '{}';}},logger:{debug(){},info(){},warn(){},error(){}}});
 const voice=new ProcessVoiceEntry({messagingGateway:gateway,processTextEntry:text,logger:{debug(){},info(){},error(){}}});
 const router=new JournalistInputRouter({getProcessTextEntry:()=>text,getProcessVoiceEntry:()=>voice},{userIdentityService:{resolveUsername:()=> 'sample'},logger:{debug(){},error(){},warn(){}}});
 const evidence=new JournalKnowledgeEvidence({loadJournal:async()=>journal,identityForUser:()=>identity,timezoneForUser:()=> 'America/Los_Angeles'});
 const event=(type='text',senderId='101')=>({platform:'telegram',platformUserId:senderId,type,conversationId:identity.conversationId,messageId:'99',metadata:{senderId,chatId:senderId,chatType:'private',replyToMessageId:'88'},payload:{text:'I will contact Sample on Monday. '.padEnd(601,'x'),fileId:'voice-file'}});
 return {router,event,principal:event=>authority.attest({event,webhookSecret:secret}),read:()=>evidence.readUserMessages({username:'sample',after:now-1000,through:now+10000}),journal:()=>journal,calls:()=>calls,models:()=>models};
}
it('persists one verified voice receipt using the original Telegram ID and delegates only once',async()=>{
 const d=setup(),event=d.event('voice');await d.router.route(event,null,{knowledgePrincipal:d.principal(event)});
 const result=await d.read();expect(result.messages).toHaveLength(1);expect(result.messages[0]).toMatchObject({messageId:'99',senderId:'101',verified:true});expect(d.journal().messages[0].source.replyToMessageId).toBe('88');expect(d.calls()).toBe(1);expect(d.models()).toBe(0);
});
it('preserves one evidence receipt when Telegram repeats the same message',async()=>{
 const d=setup(),event=d.event();await d.router.route(event,null,{knowledgePrincipal:d.principal(event)});await d.router.route(event,null,{knowledgePrincipal:d.principal(event)});
 expect((await d.read()).messages).toHaveLength(1);expect(d.journal().messages).toHaveLength(1);expect(d.models()).toBe(0);
});
it('does not manufacture verified provenance for an unknown sender',async()=>{
 const d=setup(),event=d.event('text','202');await d.router.route(event,null,{knowledgePrincipal:d.principal(event)});
 expect((await d.read()).messages).toEqual([]);expect(d.journal().messages.some(row=>row.source?.verified)).toBe(false);expect(d.calls()).toBe(0);
});
it('stores an authenticated edited entry as a new evidence revision instead of rejecting the correction',async()=>{
 const d=setup(),first=d.event();await d.router.route(first,null,{knowledgePrincipal:d.principal(first)});const original=(await d.read()).messages[0];
 const edited={...d.event(),metadata:{...d.event().metadata,edited:true,editDate:1000,updateId:22},payload:{text:'🎲 I cancelled that plan.'}};
 await d.router.route(edited,null,{knowledgePrincipal:d.principal(edited)});
 const current=(await d.read()).messages;expect(current).toHaveLength(1);expect(current[0].sourceId).not.toBe(original.sourceId);expect(current[0].content).toBe('🎲 I cancelled that plan.');expect(d.journal().messages).toHaveLength(1);
});
