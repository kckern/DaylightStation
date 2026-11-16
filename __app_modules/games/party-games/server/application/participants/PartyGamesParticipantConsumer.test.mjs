import { describe, it, expect, vi } from 'vitest';
import { createParticipantContext } from '../../../../../../__capabilities/household-identity/portable/participants.mjs';
import { PartyGamesParticipantConsumer } from './PartyGamesParticipantConsumer.mjs';

const target = { definitionId: 'charades:test', surfaceId: 'party-games' };
const roster = [
  {key:'a',participant_id:'alex',identity:{kind:'user',id:'alex'},display:{name:'Alex',avatar:{kind:'user-avatar',userId:'alex'}}},
  {key:'b',participant_id:'guest:visitor',identity:{kind:'guest',id:'visitor'},display:{name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'}}},
  {key:'c',participant_id:'anon:plan:slot',identity:{kind:'anonymous',scope_id:'plan',slot_id:'slot'},display:{name:'Guest',avatar:null}},
];
const definition = {experience:{id:'charades',version:1},rule_module:{id:'activity-party',version:1},competition:false,rounds:1,clues_per_turn:1,presentation:{image_participants:[]},challenges:[{id:'t',prompt:'word'},{id:'r',category:'early-reader',prompt:'run'},{id:'i',decoder:{image:'x'},prompt:'image'}]};
const loaded = {definition,hash:'a'.repeat(64),artifacts:{rules_definition:{id:target.definitionId,hash:'b'.repeat(64)},content_pack:{id:target.definitionId,hash:'c'.repeat(64)}}};
const manifest = {id:'charades',version:1,hash:'d'.repeat(64),surfaces:[{id:'party-games',authority_modes:['remote']}]};
const settings = {schema:'party-games-participant-setup/v1',autostart:false,charades:{default_clue_mode:'text',clue_modes:{b:'reader',c:'image'}}};
async function fixture(participants=roster, override={}) {
 const context=await createParticipantContext({scope:{provider:'agenda',id:'plan',revision:1},participants});
 const definitions={getCurrent:vi.fn(async()=>structuredClone(loaded)),pin:vi.fn(async x=>x)};
 const executionPort={createReserved:vi.fn(async ({sessionId})=>({header:{session_id:sessionId}})),resume:vi.fn(async()=>({header:{status:'active'}}))};
 const consumer=new PartyGamesParticipantConsumer({definitions,executionPort,manifestStore:{get:()=>structuredClone(manifest)},clueHistory:{list:vi.fn(async()=>[{clue_id:'t'}])},...override});
 return {context,definitions,executionPort,consumer};
}
describe('Party Games participant consumer',()=>{
 it('prepares display snapshots and modes without archiving; retains the exact inspected artifact',async()=>{
  const {consumer,context,definitions}=await fixture();
  const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
  expect(prepared.setup.data.seats.map(x=>x.id)).toEqual(['alex','guest:visitor','anon:plan:slot']);
  expect(prepared.setup.data.seats[1].members[0]).toMatchObject({id:'guest:visitor',name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'}});
  expect(prepared.setup.data.setup.charades_presentation.by_participant).toEqual({alex:'text','guest:visitor':'reader','anon:plan:slot':'image'});
  expect(prepared.setup.data.setup.charades_history_ids).toEqual(['t']);
  expect(definitions.pin).not.toHaveBeenCalled();
  await consumer.retainPrepared({prepared,viewer:{role:'host'}}); expect(definitions.pin).toHaveBeenCalledOnce();
 });
 it('honors selected order and rejects empty, unknown and missing pools without household fallback',async()=>{
  const {consumer}=await fixture(); const context=(await fixture([roster[2],roster[0]])).context;
  const selected={...settings,charades:{default_clue_mode:'text',clue_modes:{c:'image'}}};
  const prepared=await consumer.prepareSetup({target,settings:selected,participantContext:context,viewer:{role:'host'}});
  expect(prepared.setup.data.seats.map(x=>x.id)).toEqual(['anon:plan:slot','alex']);
  await expect(consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}})).rejects.toThrow(/unknown/i);
  await expect(consumer.prepareSetup({target,settings:selected,participantContext:(await fixture([])).context,viewer:{role:'host'}})).rejects.toThrow();
  const missing=await fixture(roster,{definitions:{getCurrent:async()=>({...loaded,definition:{...definition,challenges:[]}})}});
  await expect(missing.consumer.prepareSetup({target,settings,participantContext:missing.context,viewer:{role:'host'}})).rejects.toThrow(/pool/i);
 });
 it('derives a reserved ID and seed, and does not recreate a missing resumed runtime',async()=>{
  const {consumer,context,executionPort}=await fixture(); const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
  const snapshot={launch_id:'launch',consumer:{id:'party-games',version:1},snapshot_hash:'hash',participant_context:context,target,prepared};
  const result=await consumer.begin({snapshot,executionKey:'secret',viewer:{role:'host'}});
  expect(result.output.data.definition_id).toBe(target.definitionId); expect(result.runtime_ref.id).toBe('game:pl:fa7f2aea91d8eb4e29bdd8695f591bf43c223641c3c08c8dfb95e691669fe23f');
  expect(executionPort.createReserved).toHaveBeenCalledWith(expect.objectContaining({sessionId:result.runtime_ref.id,seed:3544280011,creationKey:'secret'}));
  executionPort.resume.mockResolvedValue(null);
  await expect(consumer.resume({snapshot,receipt:{runtime_ref:result.runtime_ref},viewer:{role:'host'}})).rejects.toMatchObject({code:'runtime_unavailable'});
  expect(executionPort.createReserved).toHaveBeenCalledOnce();
 });
 it('remaps only owned keys and drops deleted entries',async()=>{
  const {consumer}=await fixture(); expect(consumer.remapParticipantKeys({settings,keyMap:{b:'new',c:null}}).charades.clue_modes).toEqual({new:'reader'});
 });
});

it('rejects changed artifacts before retention and does not permit untrusted creators',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 definitions.getCurrent.mockResolvedValue({...loaded,hash:'d'.repeat(64)});
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
 expect(definitions.pin).not.toHaveBeenCalled();
 await expect(consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'participant',participant_id:'alex'}})).rejects.toMatchObject({code:'authorization_denied'});
});

it('reports unavailable when an inspected image can no longer be retained',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 definitions.pin.mockRejectedValue(new Error('Clue image changed'));
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
});

it('reports unavailable without pinning when rereading the inspected definition fails',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 const cause=new Error('content artifact charades:test is required');
 definitions.getCurrent.mockRejectedValue(cause);
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable',cause});
 expect(definitions.pin).not.toHaveBeenCalled();
});

it('freezes the inspected manifest and rejects changes before retention',async()=>{
 let current=structuredClone(manifest);
 const {consumer,context}=await fixture(roster,{manifestStore:{get:()=>current}});
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 expect(prepared.setup.data.pinnedArtifacts.manifest).toEqual(manifest);
 current={...current,hash:'e'.repeat(64)};
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
});

it('discovers resumable games only through a read-only port and fails closed when absent',async()=>{
 const {consumer,executionPort}=await fixture();
 const receipts=[{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'}}];
 await expect(consumer.findResumable({receipts,viewer:{role:'host'}})).rejects.toMatchObject({code:'participant_discovery_unavailable'});
 expect(executionPort.resume).not.toHaveBeenCalled();
 executionPort.inspect=vi.fn(async()=>({header:{status:'active'}}));
 expect(await consumer.findResumable({receipts,viewer:{role:'host'}})).toEqual([{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'},label:'Resume game'}]);
 expect(executionPort.inspect).toHaveBeenCalledOnce();expect(executionPort.resume).not.toHaveBeenCalled();
 executionPort.inspect.mockResolvedValue({header:{status:'complete'}});
 expect(await consumer.findResumable({receipts,viewer:{role:'host'}})).toEqual([{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'},label:'View result'}]);
});
