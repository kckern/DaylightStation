import { describe,it,expect,vi } from 'vitest';
import { KnowledgeQuestions } from './KnowledgeQuestions.mjs';
import { createKnowledgeCallbackTokens } from '../../adapters/knowledge/KnowledgeCallbackTokens.mjs';
import { createKnowledgePrincipalAuthority } from '../../adapters/knowledge/KnowledgePrincipalAuthority.mjs';
import { memoryStore,nextId,AS_OF,TZ,evidence } from './fixtures.testHelpers.mjs';
import { loop } from '../../domain/knowledge/fixtures.testHelpers.mjs';
const secret='synthetic-webhook-secret';
function setup({objects,enabled=true,health,state,activationDate='2026-11-03'}={}) {
 const item=loop(),store=memoryStore({objects:objects??{[item.id]:item},...(health?{health}:{}),...(state?{state}:{})});
 const tokens=createKnowledgeCallbackTokens();
 const identityForUser=username=>({username,senderId:username==='sample'?'101':'202',conversationId:username==='sample'?'telegram:b42_c101':'telegram:b42_c202'});
 const authority=createKnowledgePrincipalAuthority({webhookSecret:secret,clock:()=>AS_OF,identityForSender:id=>id==='101'?identityForUser('sample'):id==='202'?identityForUser('other'):null});
 const sources={readByRefs:vi.fn(async()=>[evidence()])};
 const service=new KnowledgeQuestions({enabled,store,evidence:sources,tokens,verifyPrincipal:authority.verify,identityForUser,userTimezone:()=>TZ,nextId:nextId(),activationDate:()=>activationDate,logger:{warn(){}}});
 const principal=(callbackData,extra={})=>{
  const username=extra.username??'sample',identity=identityForUser(username);
  return authority.attest({webhookSecret:secret,event:{platform:'telegram',platformUserId:identity.senderId,conversationId:identity.conversationId,type:extra.type??'callback',messageId:extra.messageId??'99',metadata:{senderId:identity.senderId,chatId:identity.senderId,chatType:'private',replyToMessageId:extra.replyToMessageId??null},payload:{callbackId:extra.callbackId??'callback-1',callbackData}},forwarded:extra.forwarded??false});
 };
 return {service,store,tokens,authority,principal,identityForUser,sources};
}
const select=d=>d.service.selectForMorning({username:'sample',askDate:'2026-11-03',asOf:AS_OF,max:2});
async function prepared(d,channel='morning') {
 const selected=await select(d);
 return d.service.prepareDelivery({username:'sample',conversationId:'telegram:b42_c101',selectionId:selected.selectionId,askDate:'2026-11-03',channel,questionIds:selected.questions.map(q=>q.id),asOf:AS_OF});
}
async function delivered(d) {const result=await prepared(d);await d.service.recordDelivery({username:'sample',deliveryId:result.deliveryId,botMessageId:'99',asOf:AS_OF});return result;}
const actionData=(delivery,action,d)=>delivery.choices.flat().find(button=>d.tokens.decode(button.callback_data)?.action===action).callback_data;
async function reply(d,delivery,action,extra={}) {
 const raw=actionData(delivery,action,d),decoded=d.tokens.decode(raw),principal=d.principal(raw,extra);
 return d.service.reply({principal,token:decoded.nonce,action,botMessageId:extra.messageId??'99',receiptId:principal.receiptId,asOf:extra.asOf??AS_OF+1000});
}
describe('durable knowledge questions',()=>{
 it('uses today askDate, preserves a stable selection, and counts nothing until ACK',async()=>{
  const d=setup(),first=await select(d),second=await select(d);
  expect(first).toMatchObject({mode:'knowledge',queuedCount:0});expect(first.questions).toHaveLength(1);expect(first.selectionId).toBe(second.selectionId);
  expect((await d.store.read({username:'sample'})).asks).toEqual([]);
  const a=await prepared(d),b=await prepared(d);expect(a.sendAllowed).toBe(true);expect(b.sendAllowed).toBe(false);expect(a.deliveryId).toBe(b.deliveryId);
  expect((await d.store.read({username:'sample'})).asks).toEqual([]);
  await d.service.recordDelivery({username:'sample',deliveryId:a.deliveryId,botMessageId:'99',asOf:AS_OF});
  await d.service.recordDelivery({username:'sample',deliveryId:a.deliveryId,botMessageId:'99',asOf:AS_OF});
  expect((await d.store.read({username:'sample'})).asks).toHaveLength(1);
 });
 it('distinguishes healthy empty from disabled/stale/unhealthy and honors exact36h freshness',async()=>{
  expect((await select(setup({objects:{}}))).mode).toBe('knowledge');expect((await select(setup({objects:{}}))).questions).toEqual([]);
  expect((await select(setup({enabled:false}))).mode).toBe('legacy');
  const base={available:true,conflicted:false,recovering:false,lastSweepAt:AS_OF-36*3600000};
  expect((await select(setup({health:base}))).mode).toBe('knowledge');
  expect((await select(setup({health:{...base,lastSweepAt:base.lastSweepAt-1}}))).mode).toBe('legacy');
 });
 it.each([['yes','answered'],['not_yet','waiting'],['drop','dropped']])('applies %s once and preserves user pins',async(action,status)=>{
  const original=loop({pinned:['status']}),d=setup({objects:{[original.id]:original}}),delivery=await delivered(d);
  expect((await reply(d,delivery,action)).status).toBe('applied');
  const updated=(await d.store.read({username:'sample'})).objects[original.id];expect(updated.status).toBe(status);expect(updated.pinned).toEqual(['status']);
  expect((await reply(d,delivery,action,{callbackId:'another-callback'})).status).toBe('already_applied');
 });
 it('rejects unacknowledged, unknown, expired, wrong-user, forwarded and forged-principal callbacks',async()=>{
  const d=setup(),delivery=await prepared(d);
  await expect(reply(d,delivery,'yes')).rejects.toThrow();
  await d.service.recordDelivery({username:'sample',deliveryId:delivery.deliveryId,botMessageId:'99',asOf:AS_OF});
  await expect(reply(d,delivery,'yes',{username:'other'})).rejects.toThrow();
  await expect(reply(d,delivery,'yes',{messageId:'100'})).rejects.toThrow();
  await expect(reply(d,delivery,'yes',{asOf:AS_OF+8*86400000})).rejects.toThrow();
  const raw=actionData(delivery,'yes',d),p=d.principal(raw),nonce=d.tokens.decode(raw).nonce;
  await expect(d.service.reply({principal:Object.freeze({...p}),token:nonce,action:'yes',botMessageId:'99',receiptId:p.receiptId,asOf:AS_OF})).rejects.toThrow();
  await expect(d.service.reply({principal:p,token:nonce,action:'yes',botMessageId:'99',receiptId:'forged',asOf:AS_OF})).rejects.toThrow();
 });
 it('refuses forwarded callbacks and callback principals masquerading as journal entries',async()=>{
  const d=setup(),delivery=await delivered(d);
  await expect(reply(d,delivery,'yes',{forwarded:true})).rejects.toThrow('KNOWLEDGE_AUTHORED_INPUT_REQUIRED');
  await expect(d.service.attributeEntry({principal:d.principal('debrief:ask'),sourceId:'source-forged',length:20,asOf:AS_OF+1000})).rejects.toThrow('KNOWLEDGE_ENTRY_REQUIRED');
  expect((await d.store.read({username:'sample'})).asks[0].response).toBeNull();
 });
 it('makes concurrent conflicting callbacks settle one response only',async()=>{
  const d=setup(),delivery=await delivered(d);
  const result=await Promise.all([reply(d,delivery,'yes'),reply(d,delivery,'drop',{callbackId:'callback-2'})]);
  expect(result.map(r=>r.status).sort()).toEqual(['already_applied','applied']);
  expect((await d.store.read({username:'sample'})).asks[0].response.action).toBe('yes');
 });
 it('cancels known failed sends and quarantines uncertain sends without counting asks',async()=>{
  const d=setup(),one=await prepared(d);
  await d.service.recordDeliveryFailure({username:'sample',deliveryId:one.deliveryId,uncertain:false,asOf:AS_OF});
  const two=await prepared(d);expect(two.sendAllowed).toBe(true);expect(two.deliveryId).not.toBe(one.deliveryId);
  await d.service.recordDeliveryFailure({username:'sample',deliveryId:two.deliveryId,uncertain:true,asOf:AS_OF});
  expect((await prepared(d)).sendAllowed).toBe(false);expect((await d.store.read({username:'sample'})).asks).toEqual([]);
 });
 it('refuses a saved selection once sweep health becomes stale before sending',async()=>{
  const d=setup(),selection=await select(d);
  d.store.users.get('sample').health.lastSweepAt=AS_OF-36*3600000-1;
  await expect(d.service.prepareDelivery({username:'sample',conversationId:'telegram:b42_c101',selectionId:selection.selectionId,askDate:'2026-11-03',channel:'morning',questionIds:selection.questions.map(q=>q.id),asOf:AS_OF})).rejects.toThrow('KNOWLEDGE_UNAVAILABLE');
  expect((await d.store.read({username:'sample'})).state.deliveries).toBeUndefined();
 });
 it('expires an uncertain reservation instead of permanently blocking its selection',async()=>{
  const d=setup(),one=await prepared(d);
  await d.service.recordDeliveryFailure({username:'sample',deliveryId:one.deliveryId,uncertain:true,asOf:AS_OF});
  const stored=d.store.users.get('sample');stored.state.deliveries[one.deliveryId].expiresAt=AS_OF;
  const next=await prepared(d);
  expect(next.sendAllowed).toBe(true);expect(next.deliveryId).not.toBe(one.deliveryId);
  expect((await d.store.read({username:'sample'})).state.deliveries[one.deliveryId].status).toBe('expired');
 });
 it('keeps five quiz rows with original age, works offline, and Done changes no loop',async()=>{
  const objects=Object.fromEntries(Array.from({length:8},(_,i)=>{const item=loop({id:'loop.sample-'+i,title:'Task '+i});return[item.id,item];}));
  const d=setup({objects}),morning=await delivered(d);expect((await select(d)).queuedCount).toBe(5);
  const p=d.principal('debrief:ask');const quiz=await d.service.nextQuiz({principal:p,asOf:AS_OF+1000});expect(quiz.questions).toHaveLength(1);expect(quiz.sendAllowed).toBe(true);
  await d.service.recordDelivery({username:'sample',deliveryId:quiz.deliveryId,botMessageId:'100',asOf:AS_OF+1000});
  const before=(await d.store.read({username:'sample'})).objects;
  const done=actionData(quiz,'done',d);await d.service.done({principal:d.principal(done,{messageId:'100',callbackId:'done-1'}),asOf:AS_OF+2000});
  expect((await d.store.read({username:'sample'})).objects).toEqual(before);expect((await d.store.read({username:'sample'})).state.quizSession).toBeNull();
 });
 it('prepares a bounded echo from validated normal loops and accepts only its acknowledged looks-right token',async()=>{
  const item=loop(),privateItem=loop({id:'loop.private',title:'Private secret',sensitivity:'private',ask_policy:'never'});
  const d=setup({objects:{[item.id]:item,[privateItem.id]:privateItem},state:{echoCandidates:{'extract-1':{runId:'extract-1',objectIds:[item.id,privateItem.id],reviewCount:1,createdAt:AS_OF,status:'ready'}}}});
  const delivery=await d.service.prepareEcho({username:'sample',runId:'extract-1',asOf:AS_OF});
  expect(delivery.questions).toHaveLength(1);expect(delivery.questions[0].text).toContain('Sample reply');expect(delivery.questions[0].text).not.toContain('Private secret');
  await expect(reply(d,delivery,'looks_right')).rejects.toThrow();
  await d.service.recordDelivery({username:'sample',deliveryId:delivery.deliveryId,botMessageId:'99',asOf:AS_OF});
  expect((await reply(d,delivery,'looks_right')).status).toBe('applied');
  const snapshot=await d.store.read({username:'sample'});expect(snapshot.asks).toEqual([]);expect(snapshot.objects).toEqual({[item.id]:item,[privateItem.id]:privateItem});
  expect((await d.service.prepareEcho({username:'sample',runId:'extract-1',asOf:AS_OF})).sendAllowed).toBe(false);
 });
 it('prepares one private Monday review after05:00 and binds confirmation to its own token',async()=>{
  const monday=Date.parse('2026-11-09T13:00Z'),person={...loop({id:'person.sample',kind:'person',title:'Sample',status:'candidate'}),names:['Sample'],aliases:[]};
  const d=setup({objects:{[person.id]:person},state:{pendingReviews:[{id:'review-1',reason:'person_confirmation',proposal:{id:'review-1',op:'propose_entity',target:person.id,evidenceRef:'journalist:msg:source-1',quote:'Sample',fields:{kind:'person',name:'Sample'}},createdAt:AS_OF}]},health:{available:true,conflicted:false,recovering:false,lastSweepAt:monday}});
  expect(await d.service.prepareWeeklyReview({username:'sample',asOf:monday-1})).toMatchObject({status:'not_due'});
  const delivery=await d.service.prepareWeeklyReview({username:'sample',asOf:monday});expect(delivery.sendAllowed).toBe(true);expect(delivery.questions).toHaveLength(1);
  expect((await d.service.prepareWeeklyReview({username:'sample',asOf:monday})).sendAllowed).toBe(false);
  await expect(reply(d,delivery,'confirm',{asOf:monday})).rejects.toThrow();
  await d.service.recordDelivery({username:'sample',deliveryId:delivery.deliveryId,botMessageId:'99',asOf:monday});
  expect((await reply(d,delivery,'confirm',{asOf:monday+1000})).status).toBe('applied');
  expect((await d.store.read({username:'sample'})).objects[person.id].status).toBe('active');
  expect((await d.store.read({username:'sample'})).asks).toEqual([]);
 });
 it('binds existing quiz controls to the active acknowledged quiz message',async()=>{
  const objects=Object.fromEntries(Array.from({length:4},(_,i)=>{const item=loop({id:'loop.control-'+i});return[item.id,item];})),d=setup({objects});await delivered(d);
  const quiz=await d.service.nextQuiz({principal:d.principal('debrief:ask'),asOf:AS_OF});
  await d.service.recordDelivery({username:'sample',deliveryId:quiz.deliveryId,botMessageId:'100',asOf:AS_OF});
  await expect(d.service.quizControl({principal:d.principal('journal:skip',{messageId:'99'}),asOf:AS_OF+1000})).rejects.toThrow();
  const principal=d.principal('journal:skip',{messageId:'100',callbackId:'skip-control'});
  expect((await d.service.quizControl({principal,asOf:AS_OF+1000})).action).toBe('skip');
  const updated=(await d.store.read({username:'sample'})).objects[quiz.questions[0].objectId];expect(updated.loop.ask.deferred_until).toBe('2026-11-06');
  expect(await d.service.hasActiveQuiz({principal})).toBe(false);
 });
 it('expires a seven-day quiz backlog without refreshing its original age',async()=>{
  const objects=Object.fromEntries(Array.from({length:4},(_,i)=>{const item=loop({id:'loop.aged-'+i});return[item.id,item];}));
  const d=setup({objects});await delivered(d);const initial=(await d.store.read({username:'sample'})).quiz;
  expect(initial).toHaveLength(2);
  const later=AS_OF+7*86400000,stored=d.store.users.get('sample');stored.health.lastSweepAt=later;
  const selection=await d.service.selectForMorning({username:'sample',askDate:'2026-11-10',asOf:later});
  expect(selection.queuedCount).toBe(2);
  const refreshed=(await d.store.read({username:'sample'})).quiz;
  expect(refreshed.some(row=>initial.some(old=>old.objectId===row.objectId))).toBe(false);
  expect((await d.store.read({username:'sample'})).state.quizHistory[initial[0].objectId].enqueuedAt).toBe(AS_OF);
 });
 it('keeps concurrent users deliveries and callbacks independent',async()=>{
  const d=setup();
  const selections=await Promise.all(['sample','other'].map(username=>d.service.selectForMorning({username,askDate:'2026-11-03',asOf:AS_OF})));
  const deliveries=await Promise.all(selections.map((selection,i)=>{const username=i?'other':'sample';return d.service.prepareDelivery({username,conversationId:d.identityForUser(username).conversationId,selectionId:selection.selectionId,askDate:'2026-11-03',channel:'morning',questionIds:selection.questions.map(q=>q.id),asOf:AS_OF});}));
  await Promise.all(deliveries.map((delivery,i)=>d.service.recordDelivery({username:i?'other':'sample',deliveryId:delivery.deliveryId,botMessageId:'99',asOf:AS_OF})));
  await Promise.all([reply(d,deliveries[0],'yes'),reply(d,deliveries[1],'drop',{username:'other'})]);
  expect((await d.store.read({username:'sample'})).objects['loop.application-reply'].status).toBe('answered');
  expect((await d.store.read({username:'other'})).objects['loop.application-reply'].status).toBe('dropped');
 });
 it('attributes direct replies first, a unique36h window second, and refuses ambiguous windows',async()=>{
  const d=setup(),delivery=await delivered(d);
  const p=d.principal('',{type:'text',messageId:'120',replyToMessageId:'99'});
  expect((await d.service.attributeEntry({principal:p,sourceId:'source-new',length:20,asOf:AS_OF+1000})).attribution).toBe('reply_to');
  const other=setup({objects:{'loop.one':loop({id:'loop.one'}),'loop.two':loop({id:'loop.two'})}});await delivered(other);
  expect((await other.service.attributeEntry({principal:other.principal('',{type:'text',messageId:'120'}),sourceId:'source-new',length:20,asOf:AS_OF+1000})).attribution).toBe('none');
 });
});
