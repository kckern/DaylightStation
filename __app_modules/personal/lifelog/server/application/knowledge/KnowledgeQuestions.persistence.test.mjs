import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {KnowledgeWriteAuthority} from '../../adapters/knowledge/KnowledgeWriteAuthority.mjs';
import {JsonlKnowledgeLedger} from '../../adapters/knowledge/JsonlKnowledgeLedger.mjs';
import {YamlKnowledgeStore} from '../../adapters/knowledge/YamlKnowledgeStore.mjs';
import {createKnowledgeCallbackTokens} from '../../adapters/knowledge/KnowledgeCallbackTokens.mjs';
import {createKnowledgePrincipalAuthority} from '../../adapters/knowledge/KnowledgePrincipalAuthority.mjs';
import {KnowledgeQuestions} from './KnowledgeQuestions.mjs';
import {loop,AS_OF,TZ} from '../../domain/knowledge/fixtures.testHelpers.mjs';
it('keeps prepared sends uncounted across restart, binds ACK once and replays a callback without another mutation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-delivery-')),resources=[];
 const identity={username:'sample',senderId:'101',conversationId:'telegram:b42_c101'},secret='fixture-secret';
 const create=()=>{
  const authority=new KnowledgeWriteAuthority({configuration:{enabled:true,write:true,writer_env:'test',writer_host:'fixture-host'},environment:'test',hostId:'fixture-host'});resources.push(authority);
  const ledger=new JsonlKnowledgeLedger({rootForUser:()=>root,hostId:'fixture-host',authority});
  const store=new YamlKnowledgeStore({rootForUser:()=>root,ledger,authority,clock:()=>AS_OF});
  const tokens=createKnowledgeCallbackTokens(),principals=createKnowledgePrincipalAuthority({identityForSender:()=>identity,webhookSecret:secret,clock:()=>AS_OF});
  const service=new KnowledgeQuestions({enabled:true,store,tokens,verifyPrincipal:principals.verify,identityForUser:()=>identity,userTimezone:()=>TZ,nextId:()=>crypto.randomUUID(),activationDate:()=>'2026-11-03'});
  return {store,service,ledger,tokens,principals};
 };
 try{
  const first=create(),initial=await first.store.read({username:'sample'});
  await first.store.commit({username:'sample',expectedRevision:initial.revision,runId:'initial',batch:{events:[],upserts:[loop()],moves:[],statePatch:{lastSweepAt:AS_OF},previewOnly:false}});
  const selection=await first.service.selectForMorning({username:'sample',askDate:'2026-11-03',asOf:AS_OF});
  const args={username:'sample',conversationId:identity.conversationId,selectionId:selection.selectionId,askDate:'2026-11-03',channel:'morning',questionIds:selection.questions.map(q=>q.id),asOf:AS_OF};
  const pending=await first.service.prepareDelivery(args);await first.store.close();
  const second=create();await second.store.recover({username:'sample'});
  expect((await second.service.prepareDelivery(args)).sendAllowed).toBe(false);
  expect((await second.store.read({username:'sample'})).asks).toEqual([]);
  await second.service.recordDelivery({username:'sample',deliveryId:pending.deliveryId,botMessageId:'99',asOf:AS_OF});
  await second.service.recordDelivery({username:'sample',deliveryId:pending.deliveryId,botMessageId:'99',asOf:AS_OF});
  const raw=pending.choices[0][0].callback_data,decoded=second.tokens.decode(raw);
  const principal=second.principals.attest({webhookSecret:secret,event:{platform:'telegram',type:'callback',platformUserId:'101',conversationId:identity.conversationId,messageId:'99',metadata:{senderId:'101',chatId:'101',chatType:'private'},payload:{callbackId:'reply-1',callbackData:raw}}});
  const reply={principal,token:decoded.nonce,action:decoded.action,botMessageId:'99',receiptId:principal.receiptId,asOf:AS_OF+1000};
  expect((await second.service.reply(reply)).status).toBe('applied');
  const revision=(await second.store.read({username:'sample'})).revision;
  expect((await second.service.reply(reply)).status).toBe('already_applied');
  const final=await second.store.read({username:'sample'});expect(final.revision).toBe(revision);expect(final.asks).toHaveLength(1);expect(final.objects['loop.application-reply'].status).toBe('answered');
  expect((await second.ledger.read({username:'sample'})).transactions.filter(t=>t.complete).flatMap(t=>t.prepare.batch.events).filter(e=>e.type==='knowledge.reply.applied')).toHaveLength(1);
  await second.store.close();
 }finally{await Promise.all(resources.map(r=>r.close()));fs.rmSync(root,{recursive:true,force:true});}
});
