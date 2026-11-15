import { it, expect } from 'vitest';
import yaml from 'js-yaml';
import { readTextFromPath } from '#system/utils/FileIO.mjs';
import { JournalKnowledgeEvidence } from './JournalKnowledgeEvidence.mjs';
import { reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
import { loop, snapshot, TZ, AS_OF } from '../../domain/knowledge/fixtures.testHelpers.mjs';
it('accepts the quoted commitment, queues a person candidate and rejects invented, stale, bot, alias and sensor proposals',async()=>{
 const doc=yaml.load(readTextFromPath(new URL('../../../../../../tests/_fixtures/lifelog/knowledge/messages.yml',import.meta.url)),{schema:yaml.JSON_SCHEMA});
 const evidence=new JournalKnowledgeEvidence({loadJournal:async()=>doc,identityForUser:async()=>({senderId:'reviewer_a',conversationId:'telegram:sample_private'}),timezoneForUser:()=>TZ});
 const {messages}=await evidence.readUserMessages({username:'sample',after:'2026-10-01T00:00:00Z',through:AS_OF,preview:true});
 const byId=new Map(messages.map(m=>[m.messageId,m]));
 const make=(id,op,target,mid,quote,fields)=>({id,op,target,evidenceRef:byId.get(mid)?.ref??'journalist:msg:'+mid,quote,fields});
 const proposals=[
  make('valid','open_loop','loop.new-application','message-10','I will submit the application Monday.',{title:'Submit the application',dueText:'Monday'}),
  make('invented','open_loop','loop.invented','message-10','I will donate tomorrow.',{title:'Donate'}),
  make('old-close','close_loop','loop.application-reply','message-old','That application is finished.',{status:'answered'}),
  make('unknown','touch','loop.missing','message-10','I will submit the application Monday.',{}),
  make('alias','alias_candidate','person.sample','message-12','I met Sample at the review.',{alias:'Sammy'}),
  make('person','propose_entity','person.new-sample','message-12','I met Sample at the review.',{kind:'person',name:'Sample'}),
  make('bot','open_loop','loop.bot','message-bot','I will schedule a fictional task.',{title:'Fictional task'}),
  make('sensor','open_loop','loop.sensor','message-sensor','A sensor guessed a task.',{title:'Sensor task'}),
 ];
 const person={...loop({id:'person.sample',kind:'person',status:'active',title:'Sample'}),names:['Sample'],aliases:[]};delete person.loop;
 const result=reduceKnowledge({snapshot:snapshot({'loop.application-reply':loop(),'person.sample':person}),proposals,evidence:messages,asOf:AS_OF,timezone:TZ,mode:'preview'});
 expect(result.batch.upserts.map(o=>o.id)).toEqual(['loop.new-application','person.new-sample']);
 expect(result.rejected).toHaveLength(6);
 expect(result.batch.statePatch.pendingReviews).toEqual([expect.objectContaining({reason:'person_confirmation'})]);
 expect(result.batch.previewOnly).toBe(true);
});
