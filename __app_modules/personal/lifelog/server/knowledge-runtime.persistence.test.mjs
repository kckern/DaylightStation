import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {createKnowledgeRuntime} from './knowledge-runtime.mjs';
import {fakeClock,TZ,AS_OF} from './application/knowledge/fixtures.testHelpers.mjs';
import {YamlJournalEntryRepository} from '../../journalist/server/adapters/persistence/YamlJournalEntryRepository.mjs';
import {GenerateMorningDebrief} from '../../journalist/server/application/usecases/GenerateMorningDebrief.mjs';
import {SendMorningDebrief} from '../../journalist/server/application/usecases/SendMorningDebrief.mjs';
it('persists the complete entry-to-debrief-to-tap lifecycle through production adapters and a fresh writer restart',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-full-runtime-')),time=fakeClock(AS_OF-86400000),logger={debug(){},info(){},warn(){},error(){}},identity={username:'sample',senderId:'101',conversationId:'telegram:b42_c101'},secret='fixture-secret';
 let journal={messages:[]},models=0,sent;
 const dataService={user:{read:()=>structuredClone(journal),write:(_,data)=>{journal=structuredClone(data);return true;}}};
 const configService={getHouseholdUsers:()=>['sample'],getUserProfile:()=>({timezone:TZ}),getUserHouseholdId:()=> 'household',getHouseholdTimezone:()=>TZ,getUserDir:()=>root};
 const gateway={model:'fixture-model',scoped(){return this;},async chatStructured(messages){models++;const input=JSON.parse(messages[1].content);return {proposals:[{op:'open_loop',target:'loop.sample-reply',evidenceRef:input.messages[0].ref,quote:'I will contact Sample today',fields:{title:'Contact Sample',kind_of:'status',dueText:'today',stakes:3}}]};}};
 const options={configuration:{enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-host'},environment:'fixture-prod',hostId:'fixture-host',platform:'linux',configService,dataService,userIdentityService:{resolvePlatformId:()=>identity.senderId,resolveUsername:()=>identity.username},telegramIdentityAdapter:{resolve:()=>({conversationIdString:identity.conversationId})},gateway,webhookSecret:secret,send:async()=>({messageId:'200'}),scheduler:time.scheduler,clock:time.now,logger};
 const event=(type,raw)=>({platform:'telegram',type,platformUserId:'101',conversationId:identity.conversationId,messageId:type==='callback'?'200':'99',metadata:{senderId:'101',chatId:'101',chatType:'private'},payload:{callbackId:'reply-1',callbackData:raw}});
 const file=relative=>yaml.load(fs.readFileSync(path.join(root,'lifelog/knowledge',relative),'utf8'));
 let runtime=createKnowledgeRuntime(options);
 try{
  await runtime.start();const principal=runtime.companion.capturePrincipal({event:event('text'),webhookSecret:secret});
  const repo=new YamlJournalEntryRepository({dataService,userResolver:{resolveUser:()=>identity.username},logger});
  const saved=await repo.save({id:'99',chatId:identity.conversationId,role:'user',senderId:'101',content:'I will contact Sample today. '.padEnd(201,'x'),timestamp:new Date(time.now()).toISOString(),source:{platform:'telegram',conversationId:identity.conversationId,messageId:'99',senderId:'101',verified:true,replyToMessageId:null}});
  await runtime.companion.onEntrySaved({principal,message:saved,asOf:time.now()});await time.advance(15*60000);
  expect(file('loops/sample-reply.yml').loop.due).toBe('2026-11-02');expect(models).toBe(1);
  await time.advance(86400000-15*60000);
  const generator=new GenerateMorningDebrief({lifelogAggregator:{aggregate:async()=>({_meta:{date:'2026-11-02',hasEnoughData:true,sources:['journal']},summaryText:'Contact Sample',events:[{}]})},aiGateway:{chat:async()=> 'HOOK: Contact Sample\nContact Sample.\nKB_QUESTIONS_BEGIN\nKB_QUESTIONS_END'},followUpSource:runtime.followUps,clock:time.now,userTimezone:()=>TZ,logger});
  const debrief=await generator.execute({username:'sample',date:'2026-11-02',askDate:'2026-11-03',asOf:time.now()});expect(debrief.knowledgeSelection.questions).toHaveLength(1);
  const sender=new SendMorningDebrief({messagingGateway:{sendMessage:async(_chat,text,options)=>{sent={text,options};return {messageId:'200'};}},followUpSource:runtime.followUps,clock:time.now,logger});
  await sender.execute({conversationId:identity.conversationId,debrief});expect(file('asks/2026-11-03.yml').items).toHaveLength(1);
  const raw=sent.options.choices[0][0].callback_data,p=runtime.companion.capturePrincipal({event:event('callback',raw),webhookSecret:secret});
  expect(await runtime.companion.handleCallback({principal:p,callbackData:raw,asOf:time.now()})).toMatchObject({status:'applied'});expect(file('closed/2026/sample-reply.yml').status).toBe('answered');
  await runtime.dispose();runtime=createKnowledgeRuntime(options);await runtime.start();
  const restarted=runtime.companion.capturePrincipal({event:event('callback',raw),webhookSecret:secret});
  expect(await runtime.companion.handleCallback({principal:restarted,callbackData:raw,asOf:time.now()})).toMatchObject({status:'already_applied'});expect(models).toBe(1);expect(file('asks/2026-11-03.yml').items).toHaveLength(1);
 }finally{await runtime.dispose();fs.rmSync(root,{recursive:true,force:true});}
});
