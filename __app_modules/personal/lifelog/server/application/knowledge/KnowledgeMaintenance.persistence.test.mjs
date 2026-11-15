import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { KnowledgeWriteAuthority } from '../../adapters/knowledge/KnowledgeWriteAuthority.mjs';
import { JsonlKnowledgeLedger } from '../../adapters/knowledge/JsonlKnowledgeLedger.mjs';
import { YamlKnowledgeStore } from '../../adapters/knowledge/YamlKnowledgeStore.mjs';
import { JournalKnowledgeEvidence } from '../../adapters/knowledge/JournalKnowledgeEvidence.mjs';
import { MaintainKnowledgeBase } from './MaintainKnowledgeBase.mjs';
import { KnowledgeEntryScheduler } from './KnowledgeEntryScheduler.mjs';
import { fakeClock, AS_OF, TZ, proposal } from './fixtures.testHelpers.mjs';
it.skipIf(process.platform!=='linux')('restores a real durable debounce with a fresh kernel lease and commits one validated echo',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-maintenance-')),authorities=[];
 const time=fakeClock(),logger={info(){},warn(){}},rootForUser=username=>path.join(root,username);
 const text='I will contact Sample on Monday. '.padEnd(601,'x');
 const row={id:'message-10',role:'user',senderId:'sender-sample',content:text,timestamp:'2026-11-02T17:00:00Z'};
 row.source={platform:'telegram',verified:true,messageId:row.id,senderId:row.senderId,conversationId:'private-sample',contentHash:crypto.createHash('sha256').update(JSON.stringify([row.id,row.senderId,'private-sample',row.content,row.timestamp])).digest('hex')};
 const evidence=new JournalKnowledgeEvidence({loadJournal:async()=>({messages:[row]}),identityForUser:async()=>({senderId:'sender-sample',conversationId:'private-sample'}),timezoneForUser:()=>TZ,logger});
 const selected=await evidence.readUserMessages({username:'sample',after:AS_OF-2*86400000,through:AS_OF});
 const sourceId=selected.messages[0].sourceId;
 let calls=0,acks=0,echoes=0;
 const create=()=>{
  const authority=new KnowledgeWriteAuthority({configuration:{enabled:true,write:true,writer_env:'test',writer_host:'synthetic-host'},environment:'test',hostId:'synthetic-host',logger});authorities.push(authority);
  const ledger=new JsonlKnowledgeLedger({rootForUser,hostId:'synthetic-host',authority,logger});
  const store=new YamlKnowledgeStore({rootForUser,ledger,authority,clock:time.now,logger});
  const maintenance=new MaintainKnowledgeBase({enabled:true,store,evidence,extractor:{extract:async()=>{calls++;return {proposals:[proposal({evidenceRef:'journalist:msg:'+sourceId})],modelVersion:'sample'};}},clock:time.now,userTimezone:()=>TZ,nextId:()=>crypto.randomUUID(),logger});
  const entry=new KnowledgeEntryScheduler({enabled:true,store,evidence,maintenance,scheduler:time.scheduler,clock:time.now,userTimezone:()=>TZ,nextId:()=>crypto.randomUUID(),sendAck:async()=>{acks++;return {messageId:'ack-1'};},deliverEcho:async({candidate})=>{echoes++;expect(candidate.objectIds).toEqual(['loop.application-reply']);return {messageId:'echo-1'};},logger});
  return {authority,ledger,store,maintenance,entry};
 };
 try {
  const first=create();await first.maintenance.initialize({username:'sample',asOf:AS_OF-2*86400000});
  await first.entry.onEntrySaved({username:'sample',sourceId,asOf:AS_OF});
  await first.entry.dispose();await first.store.close();await time.advance(14*60000);
  const restarted=create();await restarted.entry.restore({username:'sample'});expect(calls).toBe(0);
  await time.advance(60000);expect(calls).toBe(1);expect(acks).toBe(1);expect(echoes).toBe(1);
  const snapshot=await restarted.store.read({username:'sample'});
  expect(snapshot.objects['loop.application-reply'].title).toBe('Contact Sample');expect(snapshot.state.cursor.seen).toEqual([sourceId]);expect(snapshot.state.pendingEntry).toBeNull();
  const ledger=await restarted.ledger.read({username:'sample'});
  expect(ledger.transactions.filter(t=>t.complete).flatMap(t=>t.prepare.batch.events).filter(e=>e.type==='proposal.accepted')).toHaveLength(1);
  await restarted.entry.restore({username:'sample'});expect(echoes).toBe(1);
  await restarted.maintenance.execute({username:'sample',trigger:'nightly',asOf:time.now()});expect(calls).toBe(1);
  expect((await restarted.store.read({username:'sample'})).health.lastSweepAt).toBe(time.now());
  await restarted.entry.dispose();await restarted.store.close();
 }finally{await Promise.all(authorities.map(authority=>authority.close()));fs.rmSync(root,{recursive:true,force:true});}
});
