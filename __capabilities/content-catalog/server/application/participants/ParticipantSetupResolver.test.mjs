import { describe, it, expect } from 'vitest';
import { ParticipantSetupResolver } from './ParticipantSetupResolver.mjs';
const person = {key:'a',participant_id:'anon:p:a',identity:{kind:'anonymous',scope_id:'p',slot_id:'a'},display:{name:'Guest',avatar:null}};
const consumer = {id:'fake',version:1,describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:3,selectorSupport:['all','explicit']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},artifacts:[],preview:{schema:'preview/v1',data:{}},confirmation:'required'})};
const registry = {resolve:()=>consumer};
const source = {scope:{provider:'agenda',id:'p',revision:1},roster:[person],selector:{schema:'participant-selector/v1',mode:'all'},target:{kind:'content'},action:'display',consumer:{id:'fake',version:1},settings:{}};
describe('ParticipantSetupResolver',()=>{
 it('selects and hashes immutable source values and rejects empty required selections',async()=>{
  const resolver = new ParticipantSetupResolver({registry});
  const result=await resolver.resolve({resolvedSource:source,viewer:{}});
  expect(result.participantContext.participants).toEqual([person]);
  expect(result.setupHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(resolver.resolve({resolvedSource:{...source,selector:{schema:'participant-selector/v1',mode:'explicit',keys:[]}},viewer:{}})).rejects.toMatchObject({code:'participant_context_required'});
 });
});

it('rejects malformed descriptors and prepared envelopes',async()=>{
 const badDescriptor={...consumer,describe:()=>({participantRequirement:'unknown',minParticipants:0,maxParticipants:3,selectorSupport:['all']})};
 await expect(new ParticipantSetupResolver({registry:{resolve:()=>badDescriptor}}).resolve({resolvedSource:source,viewer:{}})).rejects.toMatchObject({code:'invalid_consumer_descriptor'});
 const badPrepared={...consumer,prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},artifacts:[],confirmation:'none'})};
 await expect(new ParticipantSetupResolver({registry:{resolve:()=>badPrepared}}).resolve({resolvedSource:source,viewer:{}})).rejects.toMatchObject({code:'invalid_prepared_setup'});
});

it('rejects a direct default with a forged context digest',async()=>{
 const bad={...consumer,resolveDefaultContext:async()=>({schema:'participant-context/v1',context_id:'pc_forged',scope:{provider:'test',id:'p',revision:1},participants:[person]})};
 await expect(new ParticipantSetupResolver({registry:{resolve:()=>bad}}).resolve({resolvedSource:{target:source.target,action:'display'},viewer:{}})).rejects.toMatchObject({code:'invalid_participant_context'});
});
