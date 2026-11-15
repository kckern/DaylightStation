import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { JournalKnowledgeEvidence } from './JournalKnowledgeEvidence.mjs';
const TZ='America/Los_Angeles', senderId='reviewer_a', conversationId='telegram:sample_private';
const digest=row=>crypto.createHash('sha256').update(JSON.stringify([String(row.id),senderId,conversationId,row.content,row.timestamp])).digest('hex');
const receipt=(id,content='I will submit the application Monday.',timestamp='2026-11-02T18:00:00Z')=>{
 const row={id,role:'user',senderId,content,timestamp};
 return {...row,source:{platform:'telegram',verified:true,senderId,conversationId,messageId:String(id),contentHash:digest(row)}};
};
const make=rows=>new JournalKnowledgeEvidence({loadJournal:async()=>({messages:rows}),identityForUser:async()=>({senderId,conversationId}),timezoneForUser:()=>TZ,logger:{warn:vi.fn()}});
const query={username:'sample',after:'2026-11-01T00:00:00Z',through:Date.parse('2026-11-04T00:00:00Z')};
describe('verified journal knowledge evidence',()=>{
 it('keeps canonical ids stable across reorder/restart and deduplicates identical receipts',async()=>{
  const a=receipt('message-10'),b=receipt('message-11','I will call the office tomorrow.','2026-11-03T18:00:00Z');
  const first=await make([b,a,a]).readUserMessages(query);
  const second=await make([a,b]).readUserMessages(query);
  expect(first.messages).toEqual(second.messages);
  expect(first.messages).toHaveLength(2);
  expect(first.messages[0]).toMatchObject({verified:true,previewOnly:false,source:'user',localDate:'2026-11-02',senderMatchesConfiguredUser:true});
  expect(first.messages[0].ref).toBe('journalist:msg:'+first.messages[0].sourceId);
 });
 it('refuses two different receipts for the same canonical message identity',async()=>{
  await expect(make([receipt('message-10'),receipt('message-10','An incompatible replacement.')]).readUserMessages(query)).rejects.toThrow(/conflict/i);
 });
 it('detects edited evidence and refuses bots, mismatched identity and unverified new rows',async()=>{
  const changed=receipt('message-10');changed.content='Changed after receipt';
  const bot={...receipt('message-11'),role:'assistant'};
  const stranger={...receipt('message-12'),source:{...receipt('message-12').source,senderId:'someone_else'}};
  const unverified=receipt('message-13');unverified.source.verified=false;
  const result=await make([changed,bot,stranger,unverified]).readUserMessages(query);
  expect(result.messages).toEqual([]);
  expect(result.rejected.map(r=>r.reason)).toEqual(expect.arrayContaining(['edited_evidence','unverified_evidence','identity_mismatch']));
 });
 it('uses explicit local timezone for legacy preview and never commits legacy rows',async()=>{
  const legacy={id:'message-10',role:'user',senderId,content:'I will apply Monday.',timestamp:'2026-11-02 09:30:00'};
  expect((await make([legacy]).readUserMessages(query)).messages).toEqual([]);
  const result=await make([legacy]).readUserMessages({...query,preview:true});
  expect(result.messages[0]).toMatchObject({at:Date.parse('2026-11-02T17:30:00Z'),previewOnly:true,verified:false});
 });
 it('captures only consumed ids so a new equal-time message remains available after model work',async()=>{
  const rows=[receipt('message-10')];const adapter=make(rows);
  const first=await adapter.readUserMessages(query);
  rows.unshift(receipt('message-09','I will send the form Monday.'));
  const later=await adapter.readUserMessages({...query,after:first.cursor});
  expect(later.messages.map(m=>m.messageId)).toEqual(['message-09']);
 });
 it('readByRefs verifies original receipt hashes and excludes missing or edited originals',async()=>{
  const rows=[receipt('message-10')],adapter=make(rows);
  const {messages}=await adapter.readUserMessages(query);
  expect(await adapter.readByRefs({username:'sample',refs:[messages[0].ref]})).toEqual(messages);
  rows[0].content='A hand-edited sentence';
  expect(await adapter.readByRefs({username:'sample',refs:[messages[0].ref]})).toEqual([]);
 });
 it('bounds a batch and leaves unconsumed messages available',async()=>{
  const rows=Array.from({length:101},(_,i)=>receipt('message-'+i));
  const adapter=make(rows),first=await adapter.readUserMessages(query);
  expect(first.messages).toHaveLength(100);
  expect((await adapter.readUserMessages({...query,after:first.cursor})).messages).toHaveLength(1);
 });
});
