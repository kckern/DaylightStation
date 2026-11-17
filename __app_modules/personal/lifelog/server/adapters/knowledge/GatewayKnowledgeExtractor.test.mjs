import { describe, it, expect, vi } from 'vitest';
import { GatewayKnowledgeExtractor } from './GatewayKnowledgeExtractor.mjs';
import { evidence, loop, proposal, TZ, AS_OF, snapshot } from '../../domain/knowledge/fixtures.testHelpers.mjs';
import { reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
const raw=()=>{const {id,...rest}=proposal();return rest;};
function setup(answer={proposals:[raw()]}) {
 const calls=[],scoped={chatStructured:vi.fn(async()=>answer)};
 const gateway={scoped:vi.fn(tags=>{calls.push(['scope',tags]);return scoped;})};
 const extractor=new GatewayKnowledgeExtractor({gateway,modelVersion:'sample-model-v1',wrapGateway:value=>{calls.push(['wrap',value]);return value;},logger:{warn:vi.fn()}});
 return {extractor,gateway,scoped,calls};
}
const query=()=>({messages:[evidence()],openLoops:[],roster:null,askedLoops:[],timezone:TZ,asOf:AS_OF});
describe('bounded knowledge proposal gateway',()=>{
 it('scopes before wrapping and makes one structured call with a finite proposal schema',async()=>{
  const {extractor,calls,scoped}=setup();
  const result=await extractor.extract(query());
  expect(calls[0]).toEqual(['scope',{app:'lifelog',feature:'knowledge-extract'}]);
  expect(calls[1][0]).toBe('wrap');
  expect(scoped.chatStructured).toHaveBeenCalledTimes(1);
  expect(scoped.chatStructured.mock.calls[0][1]).toMatchObject({maxParseAttempts:1});
  expect(result.modelVersion).toBe('sample-model-v1');
  expect(result.proposals[0].id).toMatch(/^proposal\.[a-f0-9]{64}$/);
 });
 it('projects only selected journal text, at most30 loop titles, ask references and confirmed roster',async()=>{
  const {extractor,scoped}=setup();
  const q=query();q.openLoops=Array.from({length:40},(_,i)=>loop({id:'loop.sample-'+i,privateSensor:'FORBIDDEN_SENSOR'}));
  q.school='FORBIDDEN_SCHOOL';q.finance='FORBIDDEN_FINANCE';
  q.roster={schema:'lifelog-knowledge-roster/v1',aliases:{sample:['person.sample']},unconfirmed:'FORBIDDEN_ALIAS'};
  q.askedLoops=[{objectId:'loop.sample-0',askDate:'2026-11-02',raw:'FORBIDDEN_ASK_TEXT'}];
  await extractor.extract(q);
  const payload=JSON.parse(scoped.chatStructured.mock.calls[0][0][1].content);
  expect(payload.openLoops).toHaveLength(30);
  expect(JSON.stringify(payload)).not.toContain('FORBIDDEN');
  expect(payload.roster).toEqual({sample:['person.sample']});
 });
 it('assigns stable ids from source/op/target and leaves quote validity to deterministic reduction',async()=>{
  const {extractor}=setup({proposals:[{...raw(),quote:'An invented sentence.'}]});
  const first=await extractor.extract(query()),second=await extractor.extract(query());
  expect(first.proposals[0].id).toBe(second.proposals[0].id);
  const result=reduceKnowledge({snapshot:snapshot(),proposals:first.proposals,evidence:query().messages,asOf:AS_OF,timezone:TZ,mode:'preview'});
  expect(result.batch.upserts).toEqual([]);expect(result.rejected).toHaveLength(1);
 });
 it.each([
  {proposals:[{...raw(),id:'model-chosen-id'}]},
  {proposals:[{...raw(),fields:{...raw().fields,motive:'invented'}}]},
  {proposals:[{...raw(),evidenceRef:'journalist:msg:not-selected'}]},
  {proposals:Array.from({length:21},raw)},
  {proposals:[],questionOrder:['loop.sample']},
 ])('rejects extra fields, unknown refs and excessive output',async answer=>{
  await expect(setup(answer).extractor.extract(query())).rejects.toThrow();
 });
 it('refuses unselected/bot input and excessive input before any model call',async()=>{
  const {extractor,scoped}=setup();
  await expect(extractor.extract({...query(),messages:[evidence({source:'sensor'})]})).rejects.toThrow();
  await expect(extractor.extract({...query(),messages:[evidence({content:'x'.repeat(20001)})]})).rejects.toThrow();
  expect(scoped.chatStructured).not.toHaveBeenCalled();
 });
 it('propagates a model failure without fabricating proposals or making a second call',async()=>{
  const {extractor,scoped}=setup();scoped.chatStructured.mockRejectedValue(new Error('model down'));
  await expect(extractor.extract(query())).rejects.toThrow('model down');
  expect(scoped.chatStructured).toHaveBeenCalledTimes(1);
 });
});
it('uses an explicitly configured model for the real structured call, not just its version label',async()=>{
 const calls=[],gateway={scoped:()=>({chatStructured:async(_messages,options)=>{calls.push(options);return {proposals:[]};}})};
 const extractor=new GatewayKnowledgeExtractor({gateway,modelVersion:'fixture-model',model:'fixture-model'});
 await extractor.extract(query());expect(calls[0].model).toBe('fixture-model');
});
