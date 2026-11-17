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
