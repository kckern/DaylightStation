import {it,expect} from 'vitest';
import crypto from 'node:crypto';
import {YamlJournalEntryRepository} from './YamlJournalEntryRepository.mjs';
function setup(){let data={messages:[]},fail=false;const repo=new YamlJournalEntryRepository({dataService:{user:{read:()=>structuredClone(data),write:(_,next)=>{if(fail)return false;data=structuredClone(next);return true;}}},userResolver:{resolveUser:()=> 'sample'},logger:{debug(){},error(){}}});return {repo,data:()=>data,fail:()=>{fail=true;}};}
const entry={chatId:'telegram:b42_c101',messageId:'99',role:'user',senderId:'101',senderName:'Sample',text:'I will contact Sample on Monday',source:{platform:'telegram',conversationId:'telegram:b42_c101',messageId:'99',senderId:'101',verified:true,replyToMessageId:'88'}};
it('preserves verified provenance and hashes final persisted receipt fields',async()=>{
 const d=setup(),row=await d.repo.saveMessage(entry);
 expect(row.role).toBe('user');expect(row.source).toMatchObject(entry.source);
 expect(row.source.contentHash).toBe(crypto.createHash('sha256').update(JSON.stringify(['99','101',entry.chatId,entry.text,row.timestamp])).digest('hex'));
 expect(d.data().messages[0].source).toEqual(row.source);
});
it('deduplicates the same source without changing its timestamp and rejects conflicting content',async()=>{
 const d=setup(),first=await d.repo.saveMessage(entry),second=await d.repo.saveMessage(entry);
 expect(second.timestamp).toBe(first.timestamp);expect(d.data().messages).toHaveLength(1);
 await expect(d.repo.saveMessage({...entry,text:'Changed text'})).rejects.toThrow();expect(d.data().messages).toHaveLength(1);
});
it('does not report a saved verified receipt when the data write fails',async()=>{
 const d=setup();d.fail();await expect(d.repo.saveMessage(entry)).rejects.toThrow();expect(d.data().messages).toEqual([]);
});
import {JournalKnowledgeEvidence} from '../../../../lifelog/server/adapters/knowledge/JournalKnowledgeEvidence.mjs';
it('versions authenticated edits and invalidates superseded verified evidence without accepting a conflicting duplicate',async()=>{
 const d=setup(),reader=new JournalKnowledgeEvidence({loadJournal:async()=>d.data(),identityForUser:()=>({senderId:'101',conversationId:entry.chatId}),timezoneForUser:()=> 'America/Los_Angeles'});
 const first=await d.repo.saveMessage(entry),original=(await reader.readUserMessages({username:'sample',after:0,through:Date.now()+10000})).messages[0];
 const edited=await d.repo.saveMessage({...entry,text:'I cancelled that plan.',source:{...entry.source,edited:true,editDate:1000,updateId:22}});
 expect(edited.source.revision).not.toBe(first.source.revision);expect(d.data().messages).toHaveLength(1);
 expect(await reader.readByRefs({username:'sample',refs:[original.ref]})).toEqual([]);
 const next=await reader.readUserMessages({username:'sample',after:{since:0,seen:[original.sourceId]},through:Date.now()+10000});expect(next.messages).toHaveLength(1);expect(next.messages[0].content).toBe('I cancelled that plan.');expect(await reader.readRevocations({username:'sample'})).toContain(original.ref);
 const stale=await d.repo.saveMessage(entry);expect(stale.ignoredEdit).toBe(true);expect(d.data().messages[0].content).toBe('I cancelled that plan.');
});
it('invalidates a previously verified receipt on a private edit received while KB provenance is unavailable',async()=>{
 const d=setup();await d.repo.saveMessage(entry);
 await d.repo.saveMessage({...entry,source:undefined,text:'Corrected while disabled',edit:{edited:true,editDate:1000,updateId:23}});
 expect(d.data().messages).toHaveLength(1);expect(d.data().messages[0].source.verified).toBe(false);expect(d.data().messages[0].content).toBe('Corrected while disabled');
});
it('prevents an extraction already in flight from committing text superseded by an edit',async()=>{
 const {MaintainKnowledgeBase}=await import('../../../../lifelog/server/application/knowledge/MaintainKnowledgeBase.mjs');
 const {memoryStore,nextId,proposal}=await import('../../../../lifelog/server/application/knowledge/fixtures.testHelpers.mjs');
 const d=setup(),reader=new JournalKnowledgeEvidence({loadJournal:async()=>d.data(),identityForUser:()=>({senderId:'101',conversationId:entry.chatId}),timezoneForUser:()=> 'America/Los_Angeles'}),store=memoryStore(),asOf=Date.now()+1000;
 await d.repo.saveMessage({...entry,text:entry.text.padEnd(201,'x')});let entered,release;
 const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const service=new MaintainKnowledgeBase({enabled:true,store,evidence:reader,extractor:{extract:async({messages})=>{entered();await gate;return {proposals:[proposal({evidenceRef:messages[0].ref,quote:entry.text})],modelVersion:'fixture'};}},clock:()=>asOf,userTimezone:()=> 'America/Los_Angeles',nextId:nextId()});
 const work=service.execute({username:'sample',trigger:'nightly',asOf});await started;
 await d.repo.saveMessage({...entry,text:'I cancelled that plan.',source:{...entry.source,edited:true,editDate:1000,updateId:22}});release();
 const result=await work;expect(result.acceptedIds).toEqual([]);expect((await store.read({username:'sample'})).objects).toEqual({});
 const pending=await reader.readUserMessages({username:'sample',after:(await store.read({username:'sample'})).state.cursor,through:asOf+1000});expect(pending.messages).toHaveLength(1);expect(pending.messages[0].content).toBe('I cancelled that plan.');
});
it('orders corrections by provider edit time and rejects conflicting bodies for one edit receipt',async()=>{
 const d=setup();await d.repo.saveMessage(entry);
 const source={...entry.source,edited:true,editDate:1000,updateId:22};await d.repo.saveMessage({...entry,text:'Current correction',source});
 expect((await d.repo.saveMessage({...entry,text:'Older correction',source:{...source,editDate:999,updateId:23}})).ignoredEdit).toBe(true);
 await expect(d.repo.saveMessage({...entry,text:'Conflicting same receipt',source})).rejects.toThrow('Conflicting journal edit');
 expect(d.data().messages[0].content).toBe('Current correction');
});
it('preserves the journal date while exposing a corrected old entry to the live ingestion cursor',async()=>{
 const d=setup(),timestamp='2026-11-07T18:00:00Z';
 await d.repo.save({id:'99',role:'user',senderId:'101',content:entry.text,timestamp,source:entry.source},entry.chatId);
 const before=Date.now()-1000,edited=await d.repo.saveMessage({...entry,text:'Corrected historical entry',source:{...entry.source,edited:true,editDate:1000,updateId:22}});
 expect(edited.timestamp).toBe(timestamp);
 const reader=new JournalKnowledgeEvidence({loadJournal:async()=>d.data(),identityForUser:()=>({senderId:'101',conversationId:entry.chatId}),timezoneForUser:()=> 'America/Los_Angeles'});
 const selected=await reader.readUserMessages({username:'sample',after:before,through:Date.now()+1000});expect(selected.messages).toHaveLength(1);expect(selected.messages[0].localDate).toBe('2026-11-07');
 await d.repo.saveMessage({...entry,text:'Corrected historical entry',source:{...entry.source,edited:true,editDate:1001,updateId:23}});
 const current=(await reader.readUserMessages({username:'sample',after:before,through:Date.now()+1000})).messages[0];expect(await reader.readRevocations({username:'sample'})).not.toContain(current.ref);
});
